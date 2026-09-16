import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Department, NotificationStatus, NotificationType, Priority, Role } from "../src/generated/prisma/enums";

// Two or three Command Center loads landing together each looked for an alert,
// found it missing, and each wrote it: three concurrent loads left three active
// copies per person. No list repeats them, but a list reads a fixed number of
// rows before collapsing copies, so they pushed genuine alerts off a manager's
// rail while the badge still counted them. The fix is a unique index over active
// rows (prisma/migrations/20260916090000_one_active_copy_of_an_alert), and a
// race is only a race against a real Postgres, so this suite needs one.
//
// It writes, so it never guesses where: it runs only when TEST_DATABASE_URL
// names a migrated, disposable database, and is skipped otherwise. CI's build
// job points it at its throwaway Postgres. Every row it writes hangs off
// fixtures it creates and deletes.
const databaseUrl = process.env.TEST_DATABASE_URL;

type Notifications = typeof import("../src/lib/notifications");
type Db = typeof import("../src/lib/prisma").prisma;

const suffix = randomUUID();
let notifications: Notifications;
let prisma: Db;
const ids = { advisor: "", cover: "", manager: "", customer: "", conversation: "", task: "" };

// Enough callers that, with look-then-write, several of them look before any of
// them writes.
const racers = 8;

function inParallel(count: number, run: () => Promise<unknown>) {
  return Promise.all(Array.from({ length: count }, run));
}

async function activeRows(where: Record<string, unknown>) {
  return prisma.notification.findMany({
    where: { ...where, status: { not: NotificationStatus.RESOLVED } },
  });
}

describe("one active copy of an alert per recipient", { skip: !databaseUrl && "TEST_DATABASE_URL is not set" }, () => {
  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    notifications = await import("../src/lib/notifications");
    prisma = (await import("../src/lib/prisma")).prisma;
    // Open the pool's connections up front. On a cold pool the callers queue
    // for connections as they open, one after another, and the race never runs.
    await inParallel(racers, () => prisma.$transaction(async (tx) => tx.$executeRaw`SELECT pg_sleep(0.05)`));

    const user = (name: string, role: Role) =>
      prisma.user.create({
        data: {
          name,
          email: `${name}-${suffix}@race.test`,
          passwordHash: "unused",
          role,
          department: Department.SERVICE,
        },
      });

    ids.advisor = (await user("advisor", Role.SERVICE)).id;
    ids.cover = (await user("cover", Role.SERVICE)).id;
    ids.manager = (await user("manager", Role.MANAGER)).id;
    ids.customer = (
      await prisma.customer.create({ data: { name: "Race Customer", phone: `+1555${suffix}` } })
    ).id;
    ids.conversation = (
      await prisma.conversation.create({
        data: { customerId: ids.customer, assignedUserId: ids.advisor, department: Department.SERVICE },
      })
    ).id;
    ids.task = (
      await prisma.task.create({
        data: {
          title: "Call back",
          customerId: ids.customer,
          conversationId: ids.conversation,
          assignedUserId: ids.advisor,
          department: Department.SERVICE,
          dueDate: new Date(),
        },
      })
    ).id;
  });

  after(async () => {
    if (!prisma) {
      return;
    }

    // Conversation and task deletes cascade to their alerts, and user deletes
    // to anything still addressed to the fixtures.
    await prisma.task.deleteMany({ where: { customerId: ids.customer } });
    await prisma.conversation.deleteMany({ where: { customerId: ids.customer } });
    await prisma.customer.deleteMany({ where: { id: ids.customer } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@race.test` } } });
    await prisma.$disconnect();
  });

  it("writes one row when the same alert is raised concurrently", async () => {
    await inParallel(racers, () =>
      notifications.notifyAssignee({
        type: NotificationType.FOLLOW_UP_DUE,
        title: "Follow-up due today",
        taskId: ids.task,
        conversationId: ids.conversation,
        department: Department.SERVICE,
        subjectPriority: Priority.NORMAL,
        recipientUserId: ids.advisor,
      }),
    );

    const rows = await activeRows({ taskId: ids.task, type: NotificationType.FOLLOW_UP_DUE, recipientUserId: ids.advisor });
    assert.equal(rows.length, 1);
  });

  it("lets a writer inside a transaction lose the race without failing its transaction", async () => {
    const draft = {
      type: NotificationType.SLA_MISSED,
      title: "Service response SLA missed",
      conversationId: ids.conversation,
      department: Department.SERVICE,
      subjectPriority: Priority.NORMAL,
    } as const;

    await inParallel(racers, () =>
      prisma.$transaction(async (tx) => {
        await notifications.notifyManagersTx(tx, draft);
        // Anything after the lost insert still has a live transaction to run in.
        await tx.conversation.findUniqueOrThrow({ where: { id: ids.conversation } });
      }),
    );

    const rows = await activeRows({ conversationId: ids.conversation, type: NotificationType.SLA_MISSED, recipientUserId: ids.manager });
    assert.equal(rows.length, 1);
  });

  it("leaves one row per alert when Command Center loads sweep concurrently", async () => {
    await inParallel(3, () => notifications.syncOperationalNotifications());

    const rows = await activeRows({ taskId: ids.task });
    const perKey = new Map<string, number>();

    for (const row of rows) {
      const key = `${row.type} ${row.recipientUserId}`;
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }

    assert.ok(perKey.size > 0, "the sweep raised the fixture follow-up");
    assert.deepEqual([...perKey.values()].filter((count) => count > 1), []);
  });

  it("reopens one copy of an alert that was resolved more than once", async () => {
    const copy = {
      type: NotificationType.NEW_INBOUND_MESSAGE,
      title: "New customer message",
      recipientUserId: ids.advisor,
      conversationId: ids.conversation,
      status: NotificationStatus.RESOLVED,
      resolvedAt: new Date(),
    };
    await prisma.notification.createMany({ data: [copy, copy, copy] });

    await inParallel(2, () =>
      notifications.reopenConversationNotifications(ids.conversation, [NotificationType.NEW_INBOUND_MESSAGE]),
    );

    const rows = await activeRows({ conversationId: ids.conversation, type: NotificationType.NEW_INBOUND_MESSAGE });
    assert.equal(rows.length, 1);
  });

  it("hands a thread over when both people already hold a copy of its alert", async () => {
    const copy = {
      type: NotificationType.CONVERSATION_ASSIGNED,
      title: "Conversation assigned",
      conversationId: ids.conversation,
    };
    await prisma.notification.createMany({
      data: [
        { ...copy, recipientUserId: ids.advisor },
        { ...copy, recipientUserId: ids.cover },
      ],
    });

    await prisma.$transaction((tx) =>
      notifications.readdressAssigneeNotificationsTx(tx, [ids.conversation], ids.cover),
    );

    const rows = await activeRows({ conversationId: ids.conversation, type: NotificationType.CONVERSATION_ASSIGNED });
    assert.deepEqual(
      rows.map((row) => row.recipientUserId),
      [ids.cover],
    );
  });
});
