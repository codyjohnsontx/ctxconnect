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
  readdressAssigneeNotificationsTx,
  reopenConversationNotifications,
  resolveConversationNotifications,
  resolveTaskNotifications,
} from "@/lib/notifications";
import { handOffReason } from "@/lib/conversation-controls-state";
import {
  canHandOffPermanently,
  canManageCoverage,
  coverRefusal,
  coverageOutcome,
  openConversationWhere,
  parseCoverageKind,
} from "@/lib/coverage";
import {
  type CustomerProfileSaveResult,
  checkCustomerProfile,
} from "@/lib/customer-identity";
import { readResolvesNotificationTypes } from "@/lib/notification-facts";
import { instantFromZonedIso } from "@/lib/follow-ups";
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

/**
 * Opening a thread is what makes it read. Until this existed the marker could
 * only be cleared by replying or by pressing Save controls, so a thread the
 * advisor read and decided needed nothing kept its blue dot, its place in the
 * Inbox count, its seat in `Needs action` and its row on the Command Center -
 * for good. Called from the thread pane once the conversation is actually on
 * her screen, never from a render, because a link prefetch is not reading.
 */
export async function markConversationRead(conversationId: string) {
  const user = await requireUser();
  await requireConversationAccess(user, conversationId);

  // Conditional on `unread` so re-opening a thread she has already read is a
  // read with no write and no revalidation behind it.
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, unread: true },
    data: { unread: false },
  });

  if (count === 0) {
    return;
  }

  await resolveConversationNotifications(conversationId, readResolvesNotificationTypes);

  revalidatePath("/inbox");
  revalidatePath("/command-center");
}

/**
 * The way back out. The queue is shared, and leaving a thread flagged is how an
 * advisor hands work she cannot take right now back to the floor - so reading
 * clearing the marker must not be the end of the story.
 *
 * Which means putting back everything the read withdrew, not just the marker:
 * the same `readResolvesNotificationTypes` list, so the two cannot learn
 * different answers about what opening a thread silences.
 */
export async function markConversationUnread(formData: FormData) {
  const user = await requireUser();
  const conversationId = String(formData.get("conversationId") ?? "");
  await requireConversationAccess(user, conversationId);

  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, unread: false },
    data: { unread: true },
  });

  if (count === 0) {
    return;
  }

  await reopenConversationNotifications(conversationId, readResolvesNotificationTypes);

  revalidatePath("/inbox");
  revalidatePath("/command-center");
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

/**
 * The customer's own details, corrected from the thread she is reading.
 *
 * A number nobody has met yet arrives from the inbound webhook as
 * "Unknown 9911", and until this existed nothing in Attend could ever change
 * it: the invented name followed the customer onto the queue, into the alert
 * rail, onto her follow-ups and into the "Hi {{customerName}}" opening of every
 * template - so the fastest way to greet a customer by name was to greet them
 * by the last four digits of their phone number.
 *
 * Returns the sentence the advisor should read rather than throwing, because a
 * rejected name has to be fixable in the box she typed it in. Access denial
 * still throws: that is not something she can correct by retyping.
 */
export async function updateCustomerProfile(formData: FormData): Promise<CustomerProfileSaveResult> {
  const user = await requireUser();
  const customerId = String(formData.get("customerId") ?? "");

  if (!customerId) {
    throw new Error("Customer is required.");
  }

  const checked = checkCustomerProfile({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  if (!checked.ok) {
    return { ok: false, message: checked.message };
  }

  await requireCustomerAccess(user, customerId);

  const previous = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, email: true, notes: true },
  });

  if (!previous) {
    throw new Error("Customer not found.");
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: checked.values,
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "customer.update",
      entity: "Customer",
      entityId: customerId,
      metadata: {
        name:
          previous.name === checked.values.name
            ? null
            : { from: previous.name, to: checked.values.name },
        emailChanged: previous.email !== checked.values.email,
        notesChanged: previous.notes !== checked.values.notes,
      },
    },
  });

  // Her name is on all four of these: the queue row, the customer directory,
  // every follow-up card and every alert in the rail.
  //
  // An alert already raised keeps the wording it was written with, so one
  // raised before the rename goes on saying "Unknown 9911". Rewriting stored
  // alert bodies is deliberately not done here - see the PRD's non-goals: it
  // edits the record of what an alert said at the time it was raised, and the
  // rail already joins the live customer row, so deriving the name where it is
  // read is the smaller answer when that gap is worth closing.
  revalidatePath("/inbox");
  revalidatePath("/customers");
  revalidatePath("/tasks");
  revalidatePath("/command-center");

  return { ok: true };
}

/**
 * Writes the advisor's first follow-up on a thread.
 *
 * Its due date arrives as an instant rather than as the picker's bare local
 * value, for the same reason rescheduleTask's does: this runs wherever the
 * server is - UTC on Vercel - and reading "2026-09-01T00:30" here stores a
 * follow-up she set for half past midnight at half past seven the evening
 * before, on the wrong day. The reading happens in the browser, in
 * FollowUpDueDate; instantFromZonedIso refuses anything that arrives without
 * having been through it.
 */
export async function createTask(formData: FormData) {
  const user = await requireUser();
  const customerId = String(formData.get("customerId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const assignedUserId = String(formData.get("assignedUserId") ?? "");
  const department = String(formData.get("department") ?? "");
  const priority = String(formData.get("priority") ?? "");
  const dueAt = instantFromZonedIso(String(formData.get("dueAt") ?? ""));
  const aiInsightId = String(formData.get("aiInsightId") ?? "");

  if (!title || !customerId || !department) {
    return;
  }

  // Loudly, unlike the fields above: a date that did not name its offset is a
  // date nobody can place, and storing the server's reading of it is what this
  // refusal exists to stop.
  if (!dueAt) {
    throw new Error("A follow-up needs a date it is due on.");
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
      dueDate: dueAt,
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
      metadata: {
        customerId,
        conversationId,
        assignedUserId,
        department,
        priority,
        dueAt: dueAt.toISOString(),
      },
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
    dueAt,
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

/**
 * Moves a follow-up to a new due date.
 *
 * A due date used to be set once and never again, so a plan that slipped -
 * "call me Thursday instead" - left the advisor choosing between marking the
 * follow-up done (it is not) and leaving it permanently red, which is how a
 * queue stops meaning anything. Moving the date is the honest third answer.
 *
 * The new date arrives as an instant rather than as the picker's bare local
 * value, because this runs wherever the server is - UTC on Vercel - and reading
 * "17:00" here would store a closing-time follow-up at lunchtime. See
 * instantFromZonedIso, and the reschedule panel that does the reading.
 */
export async function rescheduleTask(formData: FormData) {
  const user = await requireUser();
  const taskId = String(formData.get("taskId") ?? "");
  const dueAt = instantFromZonedIso(String(formData.get("dueAt") ?? ""));

  if (!dueAt) {
    throw new Error("A follow-up needs a date it is due on.");
  }

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
    data: { dueDate: dueAt },
  });

  // The alert that put this follow-up in front of her still carries the date it
  // was raised against, and "Follow-up overdue" wording that moving the date has
  // just made false. Answering an alert clears it; the sweep raises a fresh one
  // when the new date actually arrives.
  await resolveTaskNotifications(taskId);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "task.reschedule",
      entity: "Task",
      entityId: taskId,
      metadata: { from: task.dueDate.toISOString(), to: dueAt.toISOString() },
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

/**
 * Hands an advisor's open conversations to somebody who is here.
 *
 * The gap this closes: an advisor goes on holiday, or leaves, or is switched
 * off, and her open threads stay assigned to her. Nothing in the app moved
 * them, so the customers in them are mid-conversation with a person who is not
 * reading. Whether anyone else could even open those threads was luck - an
 * advisor in the same department could, and a thread routed to a department
 * nobody else works was reachable by no one at all.
 *
 * Two shapes, and the difference is only whether it can end. Temporary coverage
 * marks each thread with the advisor it goes back to and records who is holding
 * them from when; a permanent hand-off moves the assignment and marks nothing,
 * because there is nobody for it to go back to.
 *
 * The customer is not told. That is deliberate and is not this action's call to
 * make - see the PRD's non-goals.
 */
export async function startConversationCoverage(formData: FormData) {
  const user = await requireUser();
  const awayUserId = String(formData.get("userId") ?? "");
  const coveringUserId = String(formData.get("coveringUserId") ?? "");
  const kind = parseCoverageKind(String(formData.get("kind") ?? ""));

  if (!awayUserId || !coveringUserId) {
    throw new Error("An advisor and a cover are both required.");
  }

  if (!kind) {
    throw new Error("Coverage must be temporary or permanent.");
  }

  // The board renders the same two rules to decide whose card carries a form
  // and whether it offers "for good"; they are re-asked here because a form
  // posted from a stale tab is not a form this app rendered.
  if (!canManageCoverage(user, awayUserId)) {
    throw new Error("Coverage access denied.");
  }

  if (kind === "permanent" && !canHandOffPermanently(user)) {
    throw new Error("Only an admin can hand conversations over for good.");
  }

  await prisma.$transaction(async (tx) => {
    const [away, cover] = await Promise.all([
      tx.user.findUnique({
        where: { id: awayUserId },
        select: { id: true, name: true, active: true, coveredByUserId: true },
      }),
      tx.user.findUnique({
        where: { id: coveringUserId },
        select: { id: true, name: true, active: true, coveredByUserId: true },
      }),
    ]);

    if (!away) {
      throw new Error("That staff account no longer exists.");
    }

    // Reported as the sentence the picker would have shown, so an advisor who
    // picked a colleague who went away in the meantime reads why rather than a
    // bare failure.
    const refusal = coverRefusal(away, cover);

    if (refusal || !cover) {
      throw new Error(refusal ?? "That staff account no longer exists.");
    }

    if (away.coveredByUserId) {
      throw new Error("Those conversations are already covered. End that coverage first.");
    }

    const moving = await tx.conversation.findMany({
      where: { assignedUserId: awayUserId, ...openConversationWhere },
      select: { id: true },
    });

    const movingIds = moving.map((conversation) => conversation.id);

    if (movingIds.length > 0) {
      await tx.conversation.updateMany({
        where: { id: { in: movingIds } },
        data: { assignedUserId: cover.id },
      });

      // Only where nothing is recorded yet. A thread this advisor was herself
      // covering already names the advisor it goes back to, and overwriting
      // that would strand it with her when she returns - it belongs to somebody
      // further back who is still away.
      if (kind === "temporary") {
        await tx.conversation.updateMany({
          where: { id: { in: movingIds }, coveredForUserId: null },
          data: { coveredForUserId: awayUserId },
        });
      }

      await tx.message.createMany({
        data: movingIds.map((conversationId) => ({
          conversationId,
          senderUserId: user.id,
          direction: MessageDirection.INTERNAL,
          kind: MessageKind.NOTE,
          body:
            kind === "temporary"
              ? `System: ${user.name ?? "Staff"} handed this conversation to ${cover.name} while ${away.name} is away.`
              : `System: ${user.name ?? "Staff"} handed this conversation from ${away.name} to ${cover.name} for good.`,
          deliveryStatus: DeliveryStatus.INTERNAL,
        })),
      });

      await readdressAssigneeNotificationsTx(tx, movingIds, awayUserId, cover.id);
    }

    if (kind === "temporary") {
      // Written together: coveredSince is the instant the return rule measures
      // a reply against, so coverage with no start is coverage nobody can end
      // correctly.
      await tx.user.update({
        where: { id: awayUserId },
        data: { coveredByUserId: cover.id, coveredSince: new Date() },
      });
    }

    // Two records, because they answer two different questions and the audit
    // log is indexed on (entity, entityId). The User row answers "who covered
    // whom, when, and how many threads moved"; the Conversation rows answer
    // "where did this thread go, and when" for one thread months later.
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "coverage.start",
        entity: "User",
        entityId: awayUserId,
        metadata: { kind, coveringUserId: cover.id, conversations: movingIds.length },
      },
    });

    if (movingIds.length > 0) {
      await tx.auditLog.createMany({
        data: movingIds.map((conversationId) => ({
          userId: user.id,
          action: "conversation.coverageStart",
          entity: "Conversation",
          entityId: conversationId,
          metadata: { kind, from: awayUserId, to: cover.id },
        })),
      });
    }
  });

  revalidatePath("/coverage");
  revalidatePath("/settings");
  revalidatePath("/inbox");
  revalidatePath("/command-center");
}

/**
 * Ends coverage, either way it can end.
 *
 * `return` is the advisor coming back. Everything the cover never answered goes
 * back to her; anything the cover has replied to since coverage began stays
 * with the cover until it closes, because handing a live exchange back is a
 * second change of voice on the same conversation - see coverageOutcome in
 * src/lib/coverage.ts, which is where that rule lives and is tested.
 *
 * `keep` is the trip that turned into a departure. Nothing moves; the marks
 * that said these threads would go back are cleared, because now they will not.
 *
 * Handing threads back to an account that is switched off would recreate the
 * exact state coverage exists to end, so that half is refused until the account
 * is active again. Leaving them with the cover never is.
 */
export async function endConversationCoverage(formData: FormData) {
  const user = await requireUser();
  const returningUserId = String(formData.get("userId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");

  if (!returningUserId) {
    throw new Error("An advisor is required.");
  }

  if (outcome !== "return" && outcome !== "keep") {
    throw new Error("Coverage ends either by handing the conversations back or by leaving them.");
  }

  if (!canManageCoverage(user, returningUserId)) {
    throw new Error("Coverage access denied.");
  }

  await prisma.$transaction(async (tx) => {
    const returning = await tx.user.findUnique({
      where: { id: returningUserId },
      select: {
        id: true,
        name: true,
        active: true,
        coveredSince: true,
        coveredBy: { select: { id: true, name: true } },
      },
    });

    if (!returning) {
      throw new Error("That staff account no longer exists.");
    }

    if (!returning.coveredBy || !returning.coveredSince) {
      throw new Error("Those conversations are not covered.");
    }

    if (outcome === "return" && !returning.active) {
      throw new Error(
        "Reactivate the account before handing its conversations back, or leave them with the cover.",
      );
    }

    const covered = await tx.conversation.findMany({
      where: { coveredForUserId: returningUserId },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        // The coverage window only. Which of these messages counts as the cover
        // having answered is coverageOutcome's decision, not this query's, so
        // that rule stays in one testable place.
        messages: {
          where: { createdAt: { gte: returning.coveredSince } },
          select: { direction: true, senderUserId: true },
        },
      },
    });

    // A thread closed during coverage stays with whoever closed it, so it is
    // never a candidate to move - only its mark is cleared. That is the same
    // rule that kept closed history out of the hand-off in the first place.
    const returningIds =
      outcome === "return"
        ? covered
            .filter(
              (conversation) =>
                conversation.status !== ConversationStatus.CLOSED &&
                conversation.assignedUserId !== returningUserId &&
                coverageOutcome(returningUserId, conversation.messages) === "returns",
            )
            .map((conversation) => conversation.id)
        : [];

    if (returningIds.length > 0) {
      await tx.conversation.updateMany({
        where: { id: { in: returningIds } },
        data: { assignedUserId: returningUserId },
      });

      await tx.message.createMany({
        data: returningIds.map((conversationId) => ({
          conversationId,
          senderUserId: user.id,
          direction: MessageDirection.INTERNAL,
          kind: MessageKind.NOTE,
          body: `System: ${returning.name} is back, so this conversation returned to her from ${returning.coveredBy?.name}.`,
          deliveryStatus: DeliveryStatus.INTERNAL,
        })),
      });

      // Grouped by who was actually holding each thread: coverage can be
      // chained, so the cover named on the account is not always the person the
      // alerts on every returning thread are addressed to.
      const holders = new Map<string, string[]>();

      for (const conversation of covered) {
        if (!conversation.assignedUserId || !returningIds.includes(conversation.id)) {
          continue;
        }

        holders.set(conversation.assignedUserId, [
          ...(holders.get(conversation.assignedUserId) ?? []),
          conversation.id,
        ]);
      }

      for (const [holderId, ids] of holders) {
        await readdressAssigneeNotificationsTx(tx, ids, holderId, returningUserId);
      }
    }

    // Every covered thread loses its mark, whichever way this ended: one that
    // returned has arrived, and one that stayed is now genuinely the cover's.
    await tx.conversation.updateMany({
      where: { coveredForUserId: returningUserId },
      data: { coveredForUserId: null },
    });

    await tx.user.update({
      where: { id: returningUserId },
      data: { coveredByUserId: null, coveredSince: null },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "coverage.end",
        entity: "User",
        entityId: returningUserId,
        metadata: {
          outcome,
          coveringUserId: returning.coveredBy.id,
          coveredSince: returning.coveredSince.toISOString(),
          returned: returningIds.length,
          stayed: covered.length - returningIds.length,
        },
      },
    });

    if (covered.length > 0) {
      await tx.auditLog.createMany({
        data: covered.map((conversation) => ({
          userId: user.id,
          action: returningIds.includes(conversation.id)
            ? "conversation.coverageReturned"
            : "conversation.coverageKept",
          entity: "Conversation",
          entityId: conversation.id,
          metadata: {
            coveredFor: returningUserId,
            heldBy: conversation.assignedUserId,
          },
        })),
      });
    }
  });

  revalidatePath("/coverage");
  revalidatePath("/settings");
  revalidatePath("/inbox");
  revalidatePath("/command-center");
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
