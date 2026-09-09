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
  notificationFactCountQuery,
  notificationSubjectColumns,
  supersededNotificationCopies,
  type NotificationSubject,
} from "@/lib/notification-facts";
import { labelize } from "@/lib/utils";

type NotificationDbClient = typeof prisma | Prisma.TransactionClient;

/**
 * Everything about an alert that is not what it is about: the wording the
 * writer chose, and how it should be ranked. These are the writer's own, and
 * the two writers of an unowned thread legitimately differ here - the webhook
 * can quote the text that just arrived, the sweep only knows the thread has
 * been sitting there. What they may not differ about is the subject, which is
 * why that half comes from `NotificationSubject` instead.
 */
type NotificationDetails = {
  title: string;
  body?: string | null;
  actorUserId?: string | null;
  department?: Department | null;
  priority?: Priority;
  dueAt?: Date | null;
};

type NotificationDraft = NotificationSubject & NotificationDetails;
type AddressedNotificationDraft = NotificationDraft & { recipientUserId: string };

/**
 * The one place a draft becomes a row. Built field by field rather than spread,
 * so a writer cannot reach past the draft into a column this module has not
 * agreed to.
 */
function notificationRow(draft: AddressedNotificationDraft): Prisma.NotificationUncheckedCreateInput {
  return {
    ...notificationSubjectColumns(draft),
    recipientUserId: draft.recipientUserId,
    title: draft.title,
    body: draft.body,
    actorUserId: draft.actorUserId,
    department: draft.department,
    priority: draft.priority,
    dueAt: draft.dueAt,
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
 * Raise one recipient's row unless an active one already carries the same fact.
 * One shape for the subject makes the two writers of an unowned thread look
 * interchangeable, and they are not: this returns the existing row rather than
 * updating it, so whichever writer gets there first fixes that fact's priority
 * for good - the webhook hard-codes `Priority.HIGH` where the sweep uses
 * `conversation.priority`, so a low-priority thread whose text arrives at the
 * webhook keeps a HIGH row the sweep never corrects. The key and the badge
 * cannot see it, because priority orders the rows rather than identifying the
 * fact. Pre-existing, deliberately unchanged here, and filed separately.
 */
async function createIfMissingWithClient(
  client: NotificationDbClient,
  draft: AddressedNotificationDraft,
) {
  const data = notificationRow(draft);
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

  await Promise.all(
    unassigned.map((conversation) =>
      notifyManagers({
        type: NotificationType.UNASSIGNED_CONVERSATION,
        title: "Unassigned conversation",
        body: `${conversation.customer.name} is waiting without an owner.`,
        conversationId: conversation.id,
        department: conversation.department,
        priority: conversation.priority,
        dueAt: now,
      }),
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
        priority: Priority.HIGH,
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
        priority: overdue ? Priority.HIGH : task.priority,
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
        priority: Priority.URGENT,
        dueAt: new Date(latestInbound.createdAt.getTime() + slaMinutes * 60_000),
      });
    }),
  );
}
