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
import { prisma } from "@/lib/prisma";
import type { AppUser } from "@/lib/data";
import { dedupeNotificationFacts, notificationScanLimit } from "@/lib/notification-facts";
import { labelize } from "@/lib/utils";

type NotificationDbClient = typeof prisma | Prisma.TransactionClient;

const activeNotificationWhere = {
  status: { in: [NotificationStatus.UNREAD, NotificationStatus.READ] },
} satisfies Prisma.NotificationWhereInput;

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
 * them. Grouping in the database keeps this to one query however many
 * recipients each fact was copied to.
 */
export async function countNotificationFacts(where: Prisma.NotificationWhereInput) {
  const facts = await prisma.notification.groupBy({
    by: ["type", "conversationId", "taskId", "messageId"],
    where,
  });

  return dedupeNotificationFacts(facts).length;
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

async function createIfMissingWithClient(
  client: NotificationDbClient,
  data: Prisma.NotificationUncheckedCreateInput,
) {
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

async function notifyManagersWithClient(
  client: NotificationDbClient,
  data: Omit<Prisma.NotificationUncheckedCreateInput, "recipientUserId">,
) {
  const managers = await client.user.findMany({
    where: managerWhere,
    select: { id: true },
  });

  await Promise.all(
    managers.map((manager) =>
      createIfMissingWithClient(client, {
        ...data,
        recipientUserId: manager.id,
      }),
    ),
  );
}

async function notifyAssigneeWithClient(client: NotificationDbClient, data: Prisma.NotificationUncheckedCreateInput) {
  if (!data.recipientUserId) {
    return;
  }

  await createIfMissingWithClient(client, data);
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

export async function notifyManagers(data: Omit<Prisma.NotificationUncheckedCreateInput, "recipientUserId">) {
  await notifyManagersWithClient(prisma, data);
}

export async function notifyAssignee(data: Prisma.NotificationUncheckedCreateInput) {
  await notifyAssigneeWithClient(prisma, data);
}

export async function resolveConversationNotifications(conversationId: string, types?: NotificationType[]) {
  await resolveConversationNotificationsWithClient(prisma, conversationId, types);
}

export async function notifyManagersTx(
  client: Prisma.TransactionClient,
  data: Omit<Prisma.NotificationUncheckedCreateInput, "recipientUserId">,
) {
  await notifyManagersWithClient(client, data);
}

export async function notifyAssigneeTx(client: Prisma.TransactionClient, data: Prisma.NotificationUncheckedCreateInput) {
  await notifyAssigneeWithClient(client, data);
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

export async function getNotificationSummary(user: AppUser) {
  await syncOperationalNotifications();

  const userCanSeeAll = user.role === Role.ADMIN || user.role === Role.MANAGER;
  const scopedWhere: Prisma.NotificationWhereInput = userCanSeeAll
    ? {}
    : {
        OR: [
          { recipientUserId: user.id },
          user.department ? { department: user.department as Department } : {},
        ],
      };

  const [unreadCount, commandCount, latest] = await Promise.all([
    countNotificationFacts({
      AND: [scopedWhere, { status: NotificationStatus.UNREAD }],
    }),
    countNotificationFacts({
      AND: [scopedWhere, activeNotificationWhere],
    }),
    prisma.notification.findMany({
      where: {
        AND: [scopedWhere, activeNotificationWhere],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: notificationScanLimit,
      include: {
        conversation: { include: { customer: true } },
        task: { include: { customer: true } },
      },
    }),
  ]);

  return {
    unreadCount,
    commandCount,
    latest: dedupeNotificationFacts(latest, user.id).slice(0, 8),
  };
}
