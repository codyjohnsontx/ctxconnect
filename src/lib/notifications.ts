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
import { prisma } from "@/lib/prisma";
import {
  activeNotificationWhere,
  notificationFactCountQuery,
  notificationSubjectColumns,
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

function slaMinutesForDepartment(department: Department) {
  switch (department) {
    case Department.SALES:
      return 15;
    case Department.SERVICE:
      return 120;
    case Department.PARTS:
      return 240;
    case Department.FINANCE:
    case Department.GENERAL:
      return 60;
  }
}

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
  conversationId: string,
  types?: NotificationType[],
) {
  await client.notification.updateMany({
    where: {
      conversationId,
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

export async function notifyManagersTx(client: Prisma.TransactionClient, draft: NotificationDraft) {
  await notifyManagersWithClient(client, draft);
}

export async function notifyAssigneeTx(
  client: Prisma.TransactionClient,
  draft: AddressedNotificationDraft,
) {
  await createIfMissingWithClient(client, draft);
}

export async function resolveConversationNotificationsTx(
  client: Prisma.TransactionClient,
  conversationId: string,
  types?: NotificationType[],
) {
  await resolveConversationNotificationsWithClient(client, conversationId, types);
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
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

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

      const touchedAfterInbound = conversation.messages.some(
        (message) =>
          message.createdAt > latestInbound.createdAt &&
          (message.direction === MessageDirection.OUTBOUND ||
            message.direction === MessageDirection.INTERNAL),
      );

      if (touchedAfterInbound) {
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
