"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  MessageKind,
  Priority,
  TaskStatus,
  NotificationType,
  NotificationStatus,
} from "@/generated/prisma/client";
import {
  notifyAssignee,
  notifyManagers,
  resolveConversationNotifications,
  resolveTaskNotifications,
} from "@/lib/notifications";

async function requireSessionUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    throw new Error("Authentication required.");
  }

  return session.user;
}

export async function updateConversation(formData: FormData) {
  const user = await requireSessionUser();
  const conversationId = String(formData.get("conversationId") ?? "");
  const assignedUserId = String(formData.get("assignedUserId") ?? "");
  const status = String(formData.get("status") ?? "");
  const department = String(formData.get("department") ?? "");
  const priority = String(formData.get("priority") ?? "");
  const nextAssignedUserId = assignedUserId === "unassigned" ? null : assignedUserId;

  const previous = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      customer: true,
      assignedUser: true,
    },
  });

  if (!previous) {
    throw new Error("Conversation not found.");
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      assignedUserId: nextAssignedUserId,
      status: status as ConversationStatus,
      department: department as Department,
      priority: priority as Priority,
      unread: false,
    },
    include: {
      assignedUser: true,
      customer: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "conversation.update",
      entity: "Conversation",
      entityId: conversationId,
      metadata: { status, department, priority, assignedUserId },
    },
  });

  if (previous.assignedUserId !== nextAssignedUserId) {
    const assignmentType = previous.assignedUserId
      ? NotificationType.CONVERSATION_REASSIGNED
      : NotificationType.CONVERSATION_ASSIGNED;
    const assignedName = updated.assignedUser?.name ?? "Unassigned";

    await prisma.message.create({
      data: {
        conversationId,
        senderUserId: user.id,
        direction: MessageDirection.INTERNAL,
        kind: MessageKind.NOTE,
        body: `System: ${user.name ?? "Staff"} assigned this conversation to ${assignedName}.`,
        deliveryStatus: DeliveryStatus.INTERNAL,
      },
    });

    if (nextAssignedUserId) {
      await notifyAssignee({
        type: assignmentType,
        title: previous.assignedUserId ? "Conversation reassigned to you" : "Conversation assigned to you",
        body: `${updated.customer.name} needs follow-up.`,
        recipientUserId: nextAssignedUserId,
        actorUserId: user.id,
        conversationId,
        department: updated.department,
        priority: updated.priority,
      });
    }

    await resolveConversationNotifications(conversationId, [NotificationType.UNASSIGNED_CONVERSATION]);
  }

  if (status === ConversationStatus.CLOSED) {
    await resolveConversationNotifications(conversationId);
  }

  revalidatePath("/inbox");
  revalidatePath("/command-center");
}

export async function addInternalNote(formData: FormData) {
  const user = await requireSessionUser();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) {
    return;
  }

  await prisma.message.create({
    data: {
      conversationId,
      senderUserId: user.id,
      direction: MessageDirection.INTERNAL,
      kind: MessageKind.NOTE,
      body,
      deliveryStatus: DeliveryStatus.INTERNAL,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  await resolveConversationNotifications(conversationId, [NotificationType.SLA_MISSED]);

  revalidatePath("/inbox");
  revalidatePath("/command-center");
}

export async function createTask(formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const assignedUserId = String(formData.get("assignedUserId") ?? "");
  const department = String(formData.get("department") ?? "");
  const priority = String(formData.get("priority") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");

  if (!title || !customerId || !department || !dueDate) {
    return;
  }

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      customerId,
      conversationId: conversationId || null,
      assignedUserId: assignedUserId === "unassigned" ? null : assignedUserId,
      department: department as Department,
      priority: priority as Priority,
      dueDate: new Date(dueDate),
      status: TaskStatus.OPEN,
    },
  });

  if (conversationId) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.FOLLOW_UP_NEEDED },
    });
  }

  const notification = {
    type: NotificationType.FOLLOW_UP_DUE,
    title: "New follow-up created",
    body: title,
    taskId: task.id,
    conversationId: conversationId || null,
    department: department as Department,
    priority: priority as Priority,
    dueAt: new Date(dueDate),
  };

  await notifyManagers(notification);

  if (task.assignedUserId) {
    await notifyAssignee({
      ...notification,
      recipientUserId: task.assignedUserId,
    });
  }

  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/command-center");
}

export async function updateTaskStatus(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "");

  await prisma.task.update({
    where: { id: taskId },
    data: { status: status as TaskStatus },
  });

  if (status === TaskStatus.DONE || status === TaskStatus.CANCELED) {
    await resolveTaskNotifications(taskId);
  } else {
    await prisma.notification.updateMany({
      where: { taskId, status: NotificationStatus.RESOLVED },
      data: { status: NotificationStatus.UNREAD, resolvedAt: null },
    });
  }

  revalidatePath("/tasks");
  revalidatePath("/inbox");
  revalidatePath("/command-center");
}
