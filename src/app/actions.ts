"use server";

import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
import { handOffReason } from "@/lib/conversation-controls-state";
import { scopedConversationWhere } from "@/lib/data";
import {
  canAccessConversation,
  canUpdateTask,
  requireAdmin,
  requireConversationAccess,
  requireCustomerAccess,
} from "@/lib/permissions";
import { PASSWORD_CHANGED_REASON, requireUser } from "@/lib/session";

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
  const user = await requireUser();
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

  // Routing a thread to another department is a normal hand-off, and it is also
  // the one save that can take the thread away from the person making it. Left
  // alone, the thread page she is standing on turns into a bare 404 the moment
  // it re-renders. Send her back to the queue with the hand-off named instead,
  // carrying the same reason the panel warned her with: access can also go with
  // the assignment alone, and the banner must not then claim a department move
  // that never happened.
  if (!canAccessConversation(user, updated)) {
    const reason = handOffReason(updated, previous);

    redirect(`/inbox?movedTo=${updated.department}&handOff=${reason}`);
  }
}

export async function addInternalNote(formData: FormData) {
  const user = await requireUser();
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
  const user = await requireUser();
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
  const user = await requireUser();
  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error("Task not found.");
  }

  if (!canUpdateTask(user, task)) {
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
  const user = await requireUser();
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
  const user = await requireUser();
  requireAdmin(user);

  const targetUserId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  if (!targetUserId) {
    throw new Error("User is required.");
  }

  if (targetUserId === user.id && !active) {
    throw new Error("You cannot deactivate your own account.");
  }

  // Both branches report how many rows actually moved, because an audit log that
  // records something that did not happen misleads whoever reads it back while
  // reconstructing an incident - which is the only reason the table exists.
  let changed: number;

  if (active) {
    // Reactivating leaves the cutoff alone: the sessions the person had when
    // they were switched off must stay dead, so coming back means signing in.
    const { count } = await prisma.user.updateMany({
      where: { id: targetUserId, active: false },
      data: { active: true },
    });

    changed = count;
  } else {
    // Deactivating stamps the cutoff every session is measured against, which is
    // also the "Access ended" time Settings shows.
    //
    // `active = true` in the WHERE makes only the real transition stamp it: two
    // admins with the screen open, or one stale tab submitted five minutes late,
    // would otherwise overwrite the cutoff with a later time and move the one
    // number this record exists to make trustworthy. A second press on an
    // already-inactive account matches no rows and changes nothing.
    //
    // The clock reading comes from the database inside the statement, not from
    // JavaScript before it, so it is taken once the row lock is held. A value
    // picked out here could be older than one picked by a request that commits
    // first, which is how "access ended 2:03, last request 2:04" gets written.
    // See recordLastSeen in src/lib/session.ts for the other half of the pair.
    changed = await prisma.$executeRaw`
      UPDATE "User"
      SET "active" = false,
          "accessEndedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
          "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${targetUserId} AND "active" = true
    `;
  }

  if (changed > 0) {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "user.updateStatus",
        entity: "User",
        entityId: targetUserId,
        metadata: { active },
      },
    });
  }

  revalidatePath("/settings");
}

export async function resetStaffPassword(formData: FormData) {
  const user = await requireUser();
  requireAdmin(user);

  const targetUserId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "").trim();

  if (!targetUserId || password.length < 8) {
    throw new Error("A password of at least 8 characters is required.");
  }

  const passwordHash = await hash(password, 12);

  // The new hash alone only changes what the person types at the sign-in form.
  // Every session already signed in on the account keeps working for the rest
  // of its 30-day life, on every device - so a reset prompted by a shared or
  // stolen password left whoever held it carrying straight on, which is the one
  // thing a reset exists to stop.
  //
  // Stamping the same cutoff deactivation uses, without touching `active`, ends
  // those sessions wherever they turn up while leaving the account fully usable:
  // the person signs in once with the new password and carries on. Settings
  // shows the access record only for inactive accounts, so this does not put an
  // "Access ended" line against someone who is working normally.
  //
  // The guard on the cutoff is in the SET, not the WHERE. On a live account
  // every reset has to move it - including a second one a minute later, whose
  // whole job is the sessions minted since the first - so guarding the WHERE
  // would be wrong, and it would also stop the new hash reaching a deactivated
  // account, which is a reasonable thing to write before reactivating someone.
  // But on an account that is already inactive the cutoff is the deactivation
  // record Settings renders as "Access ended", and moving it would overwrite the
  // moment the person actually lost access with an unrelated later time. Nothing
  // is lost by leaving it alone: resolveAccount refuses an inactive account
  // before the cutoff is ever consulted, and authorize will not mint a session
  // for one either. This is the same falsification the deactivation branch
  // guarded when it stopped a repeat Deactivate restamping the cutoff, arriving
  // through a second door.
  //
  // The clock reading comes from the database inside the statement rather than
  // from JavaScript before it, for the reason recordLastSeen in
  // src/lib/session.ts spells out.
  const changed = await prisma.$executeRaw`
    UPDATE "User"
    SET "passwordHash" = ${passwordHash},
        "accessEndedAt" = CASE WHEN "active" THEN (clock_timestamp() AT TIME ZONE 'UTC') ELSE "accessEndedAt" END,
        "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
    WHERE "id" = ${targetUserId}
  `;

  // prisma.user.update used to raise on a missing row. Raw SQL reports zero
  // instead, and an admin who is told nothing must not conclude they have just
  // reset a password they did not.
  if (changed === 0) {
    throw new Error("That staff account no longer exists.");
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "user.resetPassword",
      entity: "User",
      entityId: targetUserId,
    },
  });

  revalidatePath("/settings");

  // Nothing stops an admin resetting their own password, and the cutoff above
  // ends the session they pressed the button with. That is correct - a reset
  // that skipped the resetter would be a reset that does not do what it says -
  // but it must not read as a fault. Without this they would land on a bare
  // login page on their next click, having just been signed out by their own
  // successful action with nothing on screen connecting the two.
  //
  // Their other devices, and anyone else whose password is reset, still get the
  // plain login page: the session is refused by the cutoff, and the cutoff does
  // not record why it was stamped. Only the request that performed the reset
  // knows, so only it can say so.
  if (targetUserId === user.id) {
    redirect(`/login?reason=${PASSWORD_CHANGED_REASON}`);
  }
}

export async function updateDealershipSettings(formData: FormData) {
  const user = await requireUser();
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
  const user = await requireUser();

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

  // One shape for every outcome, so no branch can report a run by the part of it
  // that went well. A reader can tell a provider outage from a budget stop:
  // failed conversations were attempted, deferred ones never were.
  const outcome = [
    `${result.briefed} briefed`,
    result.failed > 0 ? `${result.failed} failed` : null,
    result.deferred > 0 ? `${result.deferred} left for the next pass` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `AI pass over ${result.eligible} conversation${result.eligible === 1 ? "" : "s"}: ${outcome}.`;
}
