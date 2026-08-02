"use server";

import { hash } from "bcryptjs";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { maxBriefsPerPass, runAmbientBriefPass } from "@/lib/ai/ambient-pass";
import { remainingDemoBriefQuota } from "@/lib/ai/demo-cap";
import { prisma } from "@/lib/prisma";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  MessageKind,
  Priority,
  ProductEventType,
  TaskStatus,
  NotificationType,
  NotificationStatus,
  Role,
} from "@/generated/prisma/client";
import {
  notifyAssignee,
  notifyManagers,
  resolveConversationNotifications,
  resolveTaskNotifications,
} from "@/lib/notifications";
import { scopedConversationWhere } from "@/lib/data";
import { requireAdmin, requireConversationAccess, requireCustomerAccess } from "@/lib/permissions";

async function requireSessionUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    throw new Error("Authentication required.");
  }

  return session.user;
}

async function recordAiInsightFormEvent({
  aiInsightId,
  conversationId,
  type,
  userId,
}: {
  aiInsightId: string;
  conversationId: string;
  type: typeof ProductEventType.AI_NOTE_CREATED | typeof ProductEventType.AI_FOLLOW_UP_CREATED;
  userId: string;
}) {
  if (!aiInsightId) {
    return;
  }

  const insight = await prisma.conversationAiInsight.findFirst({
    where: { id: aiInsightId, conversationId },
    select: { id: true },
  });

  if (!insight) {
    return;
  }

  await prisma.productEvent.upsert({
    where: {
      type_aiInsightId: {
        type,
        aiInsightId,
      },
    },
    update: {},
    create: {
      type,
      userId,
      conversationId,
      aiInsightId,
      metadata: {
        source: "form_submit",
      },
    },
  });
}

export async function updateConversation(formData: FormData) {
  const user = await requireSessionUser();
  const conversationId = String(formData.get("conversationId") ?? "");
  const assignedUserId = String(formData.get("assignedUserId") ?? "");
  const status = String(formData.get("status") ?? "");
  const department = String(formData.get("department") ?? "");
  const priority = String(formData.get("priority") ?? "");
  const nextAssignedUserId = assignedUserId === "unassigned" ? null : assignedUserId;

  const previous = await prisma.conversation.findFirst({
    where: { id: (await requireConversationAccess(user, conversationId)).id },
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
  const aiInsightId = String(formData.get("aiInsightId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) {
    return;
  }

  await requireConversationAccess(user, conversationId);

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
  await recordAiInsightFormEvent({
    aiInsightId,
    conversationId,
    type: ProductEventType.AI_NOTE_CREATED,
    userId: user.id,
  });

  revalidatePath("/inbox");
  revalidatePath("/command-center");
}

export async function createTask(formData: FormData) {
  const user = await requireSessionUser();
  const customerId = String(formData.get("customerId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const assignedUserId = String(formData.get("assignedUserId") ?? "");
  const department = String(formData.get("department") ?? "");
  const priority = String(formData.get("priority") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");
  const aiInsightId = String(formData.get("aiInsightId") ?? "");

  if (!title || !customerId || !department || !dueDate) {
    return;
  }

  if (conversationId) {
    const conversation = await requireConversationAccess(user, conversationId);

    if (conversation.customerId !== customerId) {
      throw new Error("Conversation and customer do not match.");
    }
  } else {
    await requireCustomerAccess(user, customerId);

    if (user.role !== Role.ADMIN && user.role !== Role.MANAGER && user.department !== department) {
      throw new Error("Department access denied.");
    }
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

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "task.create",
      entity: "Task",
      entityId: task.id,
      metadata: { customerId, conversationId, assignedUserId, department, priority, dueDate },
    },
  });

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

  if (conversationId) {
    await recordAiInsightFormEvent({
      aiInsightId,
      conversationId,
      type: ProductEventType.AI_FOLLOW_UP_CREATED,
      userId: user.id,
    });
  }

  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/command-center");
}

export async function updateTaskStatus(formData: FormData) {
  const user = await requireSessionUser();
  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error("Task not found.");
  }

  if (
    user.role !== Role.ADMIN &&
    user.role !== Role.MANAGER &&
    task.assignedUserId !== user.id &&
    task.department !== user.department
  ) {
    throw new Error("Task not found or access denied.");
  }

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

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "task.updateStatus",
      entity: "Task",
      entityId: taskId,
      metadata: { status },
    },
  });

  revalidatePath("/tasks");
  revalidatePath("/inbox");
  revalidatePath("/command-center");
}

export async function createStaffUser(formData: FormData) {
  const user = await requireSessionUser();
  requireAdmin(user);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();
  const role = String(formData.get("role") ?? "") as Role;
  const departmentValue = String(formData.get("department") ?? "").trim();

  if (!name || !email || !password || !role) {
    throw new Error("Name, email, password, and role are required.");
  }

  if (password.length < 8) {
    throw new Error("A password of at least 8 characters is required.");
  }

  const passwordHash = await hash(password, 12);
  const department = departmentValue ? (departmentValue as Department) : null;

  const created = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      department,
      active: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "user.create",
      entity: "User",
      entityId: created.id,
      metadata: { email, role, department },
    },
  });

  revalidatePath("/settings");
}

export async function updateStaffUserStatus(formData: FormData) {
  const user = await requireSessionUser();
  requireAdmin(user);

  const targetUserId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  if (!targetUserId) {
    throw new Error("User is required.");
  }

  if (targetUserId === user.id && !active) {
    throw new Error("You cannot deactivate your own account.");
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { active },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "user.updateStatus",
      entity: "User",
      entityId: targetUserId,
      metadata: { active },
    },
  });

  revalidatePath("/settings");
}

export async function resetStaffPassword(formData: FormData) {
  const user = await requireSessionUser();
  requireAdmin(user);

  const targetUserId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "").trim();

  if (!targetUserId || password.length < 8) {
    throw new Error("A password of at least 8 characters is required.");
  }

  const passwordHash = await hash(password, 12);

  await prisma.user.update({
    where: { id: targetUserId },
    data: { passwordHash },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "user.resetPassword",
      entity: "User",
      entityId: targetUserId,
    },
  });

  revalidatePath("/settings");
}

export async function updateDealershipSettings(formData: FormData) {
  const user = await requireSessionUser();
  requireAdmin(user);

  const dealershipName = String(formData.get("dealershipName") ?? "").trim();
  const salesPhone = String(formData.get("salesPhone") ?? "").trim();
  const servicePhone = String(formData.get("servicePhone") ?? "").trim();
  const partsPhone = String(formData.get("partsPhone") ?? "").trim();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();

  if (!dealershipName) {
    throw new Error("Dealership name is required.");
  }

  await prisma.dealershipSettings.upsert({
    where: { id: "default" },
    update: {
      dealershipName,
      salesPhone: salesPhone || null,
      servicePhone: servicePhone || null,
      partsPhone: partsPhone || null,
      websiteUrl: websiteUrl || null,
    },
    create: {
      id: "default",
      dealershipName,
      salesPhone: salesPhone || null,
      servicePhone: servicePhone || null,
      partsPhone: partsPhone || null,
      websiteUrl: websiteUrl || null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "dealershipSettings.update",
      entity: "DealershipSettings",
      entityId: "default",
      metadata: { dealershipName, salesPhone, servicePhone, partsPhone, websiteUrl },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/inbox");
}

/**
 * Runs the ambient AI pass on demand, from the inbox.
 *
 * The pass normally runs on a schedule, before staff arrive. This is the same
 * pass with a button on it, so the work is visible rather than magic: it briefs
 * every conversation with new activity since its last brief, and skips the rest.
 *
 * Returns a plain-language result so the button reports what it actually did,
 * including doing nothing and failing.
 */
export async function runAiBriefPass(): Promise<string> {
  const user = await requireSessionUser();

  let maxBriefs: number | undefined;

  if (user.isDemo) {
    const { remaining } = await remainingDemoBriefQuota(user.id);

    if (remaining <= 0) {
      return "Demo limit reached: live AI briefs are capped for the shared demo and reset within 24 hours.";
    }

    // Both bounds apply: the per-run ceiling still holds for the demo account,
    // the daily quota only tightens it further.
    maxBriefs = Math.min(remaining, maxBriefsPerPass());
  }

  // Scoped to what this user can see: an advisor's button should not spend
  // briefs on the sales lane she cannot open.
  const result = await runAmbientBriefPass({
    userId: user.id,
    maxBriefs,
    scope: scopedConversationWhere(user),
  });

  revalidatePath("/inbox");
  revalidatePath("/command-center");

  if (result.status === "not_configured") {
    return "AI is not configured, so nothing was briefed.";
  }

  if (result.eligible === 0) {
    return "Nothing to brief. Every conversation already has a brief newer than its last message.";
  }

  if (result.briefed === 0) {
    return `The AI pass failed on ${result.failed} conversation${result.failed === 1 ? "" : "s"}. No briefs were written.`;
  }

  const extra = [
    result.failed > 0 ? `${result.failed} failed` : null,
    result.deferred > 0 ? `${result.deferred} left for the next pass` : null,
  ].filter(Boolean);

  return `Briefed ${result.briefed} conversation${result.briefed === 1 ? "" : "s"}.${extra.length ? ` ${extra.join(", ")}.` : ""}`;
}
