import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  NotificationStatus,
  NotificationType,
  Priority,
  Role,
  TaskStatus,
  type Prisma,
} from "@/generated/prisma/client";
import type { AppUser } from "@/lib/data";
import { endOfDealershipDay } from "@/lib/dealership-day";
import { prisma } from "@/lib/prisma";
import { attendedSinceInbound, slaMinutesForDepartment } from "@/lib/sla";
import {
  activeNotificationWhere,
  assigneeAddressedNotificationsWhere,
  latestCustomerTextsQuery,
  notificationFactCountQuery,
  notificationPriority,
  notificationSubjectColumns,
  quotedCustomerText,
  sameFactNotificationsWhere,
  supersededNotificationCopies,
  type CustomerText,
  type NotificationSubject,
} from "@/lib/notification-facts";
import { labelize } from "@/lib/utils";

type NotificationDbClient = typeof prisma | Prisma.TransactionClient;

/**
 * Everything about an alert that is not what it is about: the wording the
 * writer chose, and the thread or follow-up it is raised against.
 *
 * The wording is the writer's own, and the two writers of an unowned thread
 * legitimately differ there - the webhook's copy announces a text that just
 * arrived, the sweep's a thread that is still waiting. Two things they may
 * not differ about: the subject, which comes from `NotificationSubject`, and
 * the rank, which is not here at all. A writer supplies `subjectPriority` - how
 * the thread or follow-up behind the alert is ranked, which is a fact about the
 * dealership rather than a judgement - and `notificationPriority` turns that
 * into the row's rank. Handing a writer the rank itself is what let the webhook
 * hard-code HIGH over a LOW thread.
 */
type NotificationDetails = {
  title: string;
  body?: string | null;
  actorUserId?: string | null;
  department?: Department | null;
  /** How the thread or follow-up this alert is about is ranked, not the alert. */
  subjectPriority: Priority;
  dueAt?: Date | null;
  /** When what the alert reports happened, where that is not when the row is written - see `quotedCustomerText`. */
  createdAt?: Date;
};

type NotificationDraft = NotificationSubject & NotificationDetails;
type AddressedNotificationDraft = NotificationDraft & { recipientUserId: string };

/**
 * The one place a draft becomes a row. Built field by field rather than spread,
 * so a writer cannot reach past the draft into a column this module has not
 * agreed to.
 */
export function notificationRow(
  draft: AddressedNotificationDraft,
): Prisma.NotificationUncheckedCreateInput & { priority: Priority; createdAt?: Date } {
  return {
    ...notificationSubjectColumns(draft),
    recipientUserId: draft.recipientUserId,
    title: draft.title,
    body: draft.body,
    actorUserId: draft.actorUserId,
    department: draft.department,
    priority: notificationPriority(draft.type, draft.subjectPriority),
    dueAt: draft.dueAt,
    createdAt: draft.createdAt,
  };
}

const managerWhere = {
  active: true,
  role: { in: [Role.ADMIN, Role.MANAGER] },
} satisfies Prisma.UserWhereInput;

/**
 * Count the operational facts a reader has waiting, not the rows that carry
 * them. The database returns the number and nothing else, however many
 * recipients each fact was copied to and however long the thread behind it has
 * been running - this runs on every page load.
 */
export async function countNotificationFacts(
  user: AppUser,
  options: { type?: NotificationType } = {},
) {
  const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>(
    notificationFactCountQuery(user, options.type),
  );

  return Number(count);
}

export function notificationHref(notification: {
  conversationId?: string | null;
  taskId?: string | null;
}) {
  if (notification.conversationId) {
    return `/inbox/${notification.conversationId}`;
  }

  if (notification.taskId) {
    return "/tasks";
  }

  return "/command-center";
}

/**
 * Raise one recipient's row unless an active one already stands for it, and
 * bring the rank of every standing copy of that fact up to date either way.
 *
 * The row is matched on all of its stored columns, so a thread alert raised
 * from a later text is a new row: that is what
 * content/decisions/2026-08-19-thread-alerts-keep-the-text-that-raised-them.md
 * chose, so the Command Center can preview the latest text rather than the
 * first, and the read side collapses those rows to one fact afterwards.
 *
 * Which is exactly why the rank cannot be left at whatever each row was written
 * with. The rows collapse but the scan does not: a list orders by priority and
 * reads only `notificationScanLimit` rows before collapsing them, so the fact
 * is listed at the rank of its highest-ranked copy, and a stale rank moves the
 * whole fact through that list - high enough to push a genuine alert off the
 * end, low enough to be pushed off it. So the rank is corrected across the
 * whole fact rather than on the one row this call happened to match, and across
 * every recipient's copy rather than the recipient being raised for. Both
 * matter because both leave copies no writer returns to: one raised from an
 * inbound text, because that text will not arrive again, and one addressed to
 * somebody the sweep has stopped raising for - see `sameFactNotificationsWhere`.
 *
 * Cheap in the steady state. The rank comes from `notificationPriority`, so
 * every writer of one fact computes the same value, and the update matches
 * nothing unless the thread or follow-up behind the alert has actually been
 * re-ranked since. Wording and due time are deliberately not reconciled - those
 * are the writer's own, and the row already on the rail is the one the reader
 * has been looking at.
 */
async function createIfMissingWithClient(
  client: NotificationDbClient,
  draft: AddressedNotificationDraft,
) {
  const data = notificationRow(draft);
  const priority = data.priority;
  const thisFact = {
    ...sameFactNotificationsWhere(data),
    ...activeNotificationWhere,
  };

  await client.notification.updateMany({
    where: { ...thisFact, priority: { not: priority } },
    data: { priority },
  });

  const existing = await client.notification.findFirst({
    where: {
      type: data.type,
      recipientUserId: data.recipientUserId ?? null,
      conversationId: data.conversationId ?? null,
      taskId: data.taskId ?? null,
      messageId: data.messageId ?? null,
      ...activeNotificationWhere,
    },
  });

  if (existing) {
    return existing;
  }

  return client.notification.create({ data });
}

async function notifyManagersWithClient(client: NotificationDbClient, draft: NotificationDraft) {
  const managers = await client.user.findMany({
    where: managerWhere,
    select: { id: true },
  });

  await Promise.all(
    managers.map((manager) =>
      createIfMissingWithClient(client, {
        ...draft,
        recipientUserId: manager.id,
      }),
    ),
  );
}

async function resolveConversationNotificationsWithClient(
  client: NotificationDbClient,
  conversationId: string | string[],
  types?: NotificationType[],
) {
  await client.notification.updateMany({
    where: {
      conversationId: Array.isArray(conversationId) ? { in: conversationId } : conversationId,
      status: { not: NotificationStatus.RESOLVED },
      ...(types ? { type: { in: types } } : {}),
    },
    data: {
      status: NotificationStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });
}

export async function notifyManagers(draft: NotificationDraft) {
  await notifyManagersWithClient(prisma, draft);
}

export async function notifyAssignee(draft: AddressedNotificationDraft) {
  await createIfMissingWithClient(prisma, draft);
}

export async function resolveConversationNotifications(conversationId: string, types?: NotificationType[]) {
  await resolveConversationNotificationsWithClient(prisma, conversationId, types);
}

/**
 * The inverse of that write, for the one thing that undoes the read: putting a
 * thread back to unread. Nothing re-raises the alert that says a text arrived -
 * the inbound webhook writes it once, and the operational sweep does not know
 * the type - so leaving the resolved rows resolved hands the advisor back her
 * blue dot and loses her rail entry for good. Rows go back to UNREAD rather
 * than to whatever they were, because a thread she has put back is one she has
 * not dealt with.
 */
export async function reopenConversationNotifications(
  conversationId: string,
  types?: NotificationType[],
) {
  await prisma.notification.updateMany({
    where: {
      conversationId,
      status: NotificationStatus.RESOLVED,
      ...(types ? { type: { in: types } } : {}),
    },
    data: {
      status: NotificationStatus.UNREAD,
      resolvedAt: null,
    },
  });
}

export async function notifyManagersTx(client: Prisma.TransactionClient, draft: NotificationDraft) {
  await notifyManagersWithClient(client, draft);
}

export async function notifyAssigneeTx(
  client: Prisma.TransactionClient,
  draft: AddressedNotificationDraft,
) {
  await createIfMissingWithClient(client, draft);
}

/**
 * Withdraws the alerts about a state that has stopped being true - resolved
 * rather than deleted, so the rail keeps the record of it.
 *
 * Takes one thread or a batch of them, because an action that has just given a
 * whole coverage's worth of threads an owner wants one write rather than the
 * same write N times inside its transaction. An empty batch skips the write.
 */
export async function resolveConversationNotificationsTx(
  client: Prisma.TransactionClient,
  conversationId: string | string[],
  types?: NotificationType[],
) {
  if (Array.isArray(conversationId) && conversationId.length === 0) {
    return;
  }

  await resolveConversationNotificationsWithClient(client, conversationId, types);
}

/**
 * Re-addresses the alerts a thread raises against whoever holds it, when the
 * thread changes hands.
 *
 * Coverage moves the assignment; without this the alerts already standing on
 * those threads keep naming the advisor who has gone away. A `Notification` row
 * is stored once per recipient, so those rows are then in nobody's rail: the
 * cover has the threads in her queue and no alert telling her which of them are
 * waiting on her - see `assigneeAddressedTypes` for which alerts those are and
 * which deliberately stay put.
 *
 * Moves rather than resolves-and-raises. The fact has not changed - a customer
 * is still waiting on that thread, since the moment they were - and re-raising
 * would restart the clock the alert is a record of. Only the person answerable
 * for it changed.
 *
 * Takes only the thread's new holder, never the old one. Every row of these
 * three types belongs to whoever was holding the conversation - they are
 * written by `notifyAssignee` to `Conversation.assignedUserId` and nowhere else,
 * and the alerts addressed to managers (`SLA_MISSED`, `MESSAGE_FAILED`,
 * `UNASSIGNED_CONVERSATION`) are other types that `assigneeAddressedTypes`
 * already excludes. So there is no manager's copy for a `from` filter to
 * protect, and asking who held a row is what used to strand one: a thread left
 * unassigned mid-coverage, or routed back by hand, had no previous holder to
 * name and its alerts stayed with the cover after the thread had gone. Do not
 * put the filter back.
 *
 * Moves every row of these types on the thread, resolved ones included, and
 * without reading them: which rows those are is a `where` clause rather than a
 * list this has to hold - `assigneeAddressedNotificationsWhere` in
 * src/lib/notification-facts.ts, where the reason status is not part of it is
 * written down. A thread can hold an alert per inbound text over its life, and
 * a hand-off reads none of that history.
 *
 * Then leaves her one OUTSTANDING row per fact. A thread can arrive here
 * already carrying a row addressed to `to` - it was hers before coverage moved
 * it, and the copy raised for the cover is a second row for the same fact - and
 * both standing would give her two. That is worse than untidy: the rail applies
 * its `take` to ROWS and collapses them afterwards, so copies eat scan slots and
 * can push a genuine alert off the end of the list while the badge still counts
 * it. An alert that exists and cannot be seen is the failure this whole file is
 * meant to prevent.
 *
 * The copies are resolved, never deleted, like every other withdrawal here.
 * Which means it is reversible, and honestly so: `reopenConversationNotifications`
 * revives every resolved row on the thread, so marking it unread brings the
 * copies back and the thread holds one alert per inbound text again. That is
 * where any long-lived thread already stands and is not something a hand-off
 * creates - see `notificationScanLimit` for where the bound belongs and why it
 * is filed separately.
 */
export async function readdressAssigneeNotificationsTx(
  client: Prisma.TransactionClient,
  conversationIds: string[],
  to: string,
) {
  if (conversationIds.length === 0) {
    return;
  }

  const onTheseThreads = assigneeAddressedNotificationsWhere(conversationIds);

  await client.notification.updateMany({
    where: { ...onTheseThreads, recipientUserId: { not: to } },
    data: { recipientUserId: to },
  });

  // Hers now, whichever way they got here. Read inside the caller's
  // transaction, so a row raised between the move and the write below cannot be
  // missed by it.
  const outstanding = await client.notification.findMany({
    where: { ...onTheseThreads, ...activeNotificationWhere },
    select: {
      id: true,
      conversationId: true,
      type: true,
      taskId: true,
      messageId: true,
      createdAt: true,
    },
  });

  const superseded = supersededNotificationCopies(outstanding);

  if (superseded.length > 0) {
    await client.notification.updateMany({
      where: { id: { in: superseded } },
      data: { status: NotificationStatus.RESOLVED, resolvedAt: new Date() },
    });
  }
}

export async function resolveTaskNotifications(taskId: string) {
  await prisma.notification.updateMany({
    where: {
      taskId,
      status: { not: NotificationStatus.RESOLVED },
    },
    data: {
      status: NotificationStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });
}

/**
 * The newest text the customer sent on each thread, by thread. One statement for
 * the whole batch and none for an empty one, because the sweep runs on every
 * Command Center load - see `latestCustomerTextsQuery`.
 */
async function latestCustomerTexts(conversationIds: string[]) {
  if (conversationIds.length === 0) {
    return new Map<string, CustomerText>();
  }

  const rows = await prisma.$queryRaw<Array<CustomerText & { conversationId: string }>>(
    latestCustomerTextsQuery(conversationIds),
  );

  return new Map(rows.map(({ conversationId, id, body, createdAt }) => [conversationId, { id, body, createdAt }]));
}

/**
 * The sweep's copy of an unowned thread's alert, quoting the newest text the
 * customer sent the way the webhook's copy quotes the text that just landed.
 *
 * On a thread texted while it had an owner and set to unassigned since, this is
 * the only copy that can show the customer's words: those texts raised alerts
 * addressed to the owner, and setting the thread unassigned withdrew its
 * unowned-thread copies. Only a thread the customer has never texted keeps the
 * generic line.
 *
 * Quoting the newest text is also what keeps a load where nothing happened from
 * writing. The text is the one quoted last time, so every column
 * `createIfMissingWithClient` matches on is too, and it finds the row it wrote -
 * or, where the webhook raised the thread for that text, the webhook's row.
 */
export function unassignedConversationAlert(
  conversation: { id: string; department: Department; priority: Priority; customer: { name: string } },
  latestText: CustomerText | undefined,
  now: Date,
): NotificationDraft {
  const customerName = conversation.customer.name;

  return {
    type: NotificationType.UNASSIGNED_CONVERSATION,
    title: "Unassigned conversation",
    ...(latestText
      ? quotedCustomerText(customerName, latestText)
      : { body: `${customerName} is waiting without an owner.` }),
    conversationId: conversation.id,
    department: conversation.department,
    subjectPriority: conversation.priority,
    dueAt: now,
  };
}

export async function syncOperationalNotifications() {
  const now = new Date();
  // The sweep has no viewer to ask what day it is, so it asks the dealership -
  // see src/lib/dealership-day.ts. Reading the server's clock here left a
  // follow-up set for 8pm Central without its FOLLOW_UP_DUE alert, because on a
  // UTC server that instant belongs to tomorrow.
  const todayEnd = endOfDealershipDay(now);

  const [unassigned, failedMessages, dueTasks, conversations] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        assignedUserId: null,
        status: { not: ConversationStatus.CLOSED },
      },
      include: { customer: true },
    }),
    prisma.message.findMany({
      where: {
        deliveryStatus: DeliveryStatus.FAILED,
      },
      include: {
        conversation: { include: { customer: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] },
        dueDate: { lte: todayEnd },
      },
      include: { customer: true },
    }),
    prisma.conversation.findMany({
      where: {
        status: { not: ConversationStatus.CLOSED },
      },
      include: {
        customer: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 12,
        },
      },
    }),
  ]);

  const latestTexts = await latestCustomerTexts(unassigned.map((conversation) => conversation.id));

  await Promise.all(
    unassigned.map((conversation) =>
      notifyManagers(unassignedConversationAlert(conversation, latestTexts.get(conversation.id), now)),
    ),
  );

  await Promise.all(
    failedMessages.map((message) =>
      notifyManagers({
        type: NotificationType.MESSAGE_FAILED,
        title: "Message failed",
        body: `${message.conversation.customer.name}: ${message.errorMessage ?? "Outgoing message failed."}`,
        conversationId: message.conversationId,
        messageId: message.id,
        department: message.conversation.department,
        subjectPriority: message.conversation.priority,
        dueAt: message.updatedAt,
      }),
    ),
  );

  await Promise.all(
    dueTasks.map(async (task) => {
      const overdue = task.dueDate < now;
      const notification = {
        type: overdue ? NotificationType.FOLLOW_UP_OVERDUE : NotificationType.FOLLOW_UP_DUE,
        title: overdue ? "Follow-up overdue" : "Follow-up due today",
        body: `${task.title} for ${task.customer.name}`,
        taskId: task.id,
        conversationId: task.conversationId,
        department: task.department,
        // The rank belongs to the alert type rather than to this writer - see
        // `notificationPriority`. FOLLOW_UP_OVERDUE carries a fixed HIGH that
        // stands in place of the follow-up's own rank, so going late lifts a
        // NORMAL follow-up's alert and drops an URGENT one.
        subjectPriority: task.priority,
        dueAt: task.dueDate,
      };

      // A follow-up that has gone past its time is no longer merely due today,
      // and the other way round after it has been moved. Withdraw the state it
      // left behind, or the queue keeps an alert that is no longer true.
      await prisma.notification.updateMany({
        where: {
          taskId: task.id,
          type: overdue ? NotificationType.FOLLOW_UP_DUE : NotificationType.FOLLOW_UP_OVERDUE,
          status: { not: NotificationStatus.RESOLVED },
        },
        data: {
          status: NotificationStatus.RESOLVED,
          resolvedAt: now,
        },
      });

      await notifyManagers(notification);

      if (task.assignedUserId) {
        await notifyAssignee({
          ...notification,
          recipientUserId: task.assignedUserId,
        });
      }
    }),
  );

  await Promise.all(
    conversations.map(async (conversation) => {
      const latestInbound = conversation.messages.find(
        (message) => message.direction === MessageDirection.INBOUND,
      );

      if (!latestInbound) {
        return;
      }

      // Anything a person did about this customer clears the alert; a note
      // Attend wrote itself while moving the thread does not. The rule lives in
      // src/lib/sla.ts so both halves of it can be run in a test.
      if (attendedSinceInbound(latestInbound.createdAt, conversation.messages)) {
        await resolveConversationNotifications(conversation.id, [NotificationType.SLA_MISSED]);
        return;
      }

      const slaMinutes = slaMinutesForDepartment(conversation.department);
      const ageMinutes = (now.getTime() - latestInbound.createdAt.getTime()) / 60_000;

      if (ageMinutes < slaMinutes) {
        return;
      }

      await notifyManagers({
        type: NotificationType.SLA_MISSED,
        title: `${labelize(conversation.department)} response SLA missed`,
        body: `${conversation.customer.name} has not been touched in ${Math.floor(ageMinutes)} minutes.`,
        conversationId: conversation.id,
        department: conversation.department,
        subjectPriority: conversation.priority,
        dueAt: new Date(latestInbound.createdAt.getTime() + slaMinutes * 60_000),
      });
    }),
  );
}
