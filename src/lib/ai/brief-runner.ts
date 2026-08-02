import {
  type ConversationAiInsight,
  ProductEventType,
  TaskStatus,
} from "@/generated/prisma/client";
import {
  generateAiOpsBrief,
  getAiOpsBriefModel,
  isAiOpsBriefConfigured,
  redactProviderSecrets,
} from "@/lib/ai/ops-brief";
import { prisma } from "@/lib/prisma";

const AI_CONTEXT_MESSAGE_DAYS = 90;
const AI_CONTEXT_TASK_LOOKBACK_DAYS = 30;
const MAX_AI_MESSAGES = 30;
const MAX_AI_TASKS = 12;
const MAX_SUBJECT_CHARS = 240;
const MAX_CUSTOMER_NOTES_CHARS = 800;
const MAX_MESSAGE_BODY_CHARS = 1400;
const MAX_TASK_TITLE_CHARS = 180;

/** Where a brief request came from. Recorded on every AI ProductEvent. */
export type BriefSource = "inbox" | "ambient_pass" | "seed";

export type BriefFailureReason =
  | "not_found"
  | "openai_not_configured"
  | "provider_failure"
  | "persist_failure";

export type BriefRunResult =
  | { ok: true; insight: ConversationAiInsight }
  | { ok: false; reason: BriefFailureReason; message: string };

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function truncateForAi(value: string | null, maxLength: number) {
  if (!value) {
    return value;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/**
 * Loads the bounded slice of a conversation that is safe and useful to send to
 * the model: recent messages and live tasks only, every free-text field capped.
 */
export async function loadConversationBriefContext(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      department: true,
      status: true,
      priority: true,
      subject: true,
      customer: {
        select: {
          name: true,
          smsOptedOut: true,
          notes: true,
        },
      },
      messages: {
        where: {
          createdAt: { gte: daysAgo(AI_CONTEXT_MESSAGE_DAYS) },
        },
        orderBy: { createdAt: "desc" },
        take: MAX_AI_MESSAGES,
        select: {
          direction: true,
          body: true,
          deliveryStatus: true,
          createdAt: true,
          sender: {
            select: {
              name: true,
            },
          },
        },
      },
      tasks: {
        where: {
          OR: [
            { dueDate: { gte: daysAgo(AI_CONTEXT_TASK_LOOKBACK_DAYS) } },
            { status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] } },
          ],
        },
        orderBy: { dueDate: "asc" },
        take: MAX_AI_TASKS,
        select: {
          title: true,
          dueDate: true,
          status: true,
          priority: true,
        },
      },
    },
  });
}

/**
 * Generates one AI ops brief and persists it with its ProductEvents.
 *
 * Every exit path is recorded. A missing key or a provider failure returns a
 * failure result and writes AI_INSIGHT_FAILED; neither one ever writes a brief,
 * so the UI degrades to "no brief" rather than to a fabricated one.
 */
export async function generateAndSaveBrief({
  conversationId,
  userId,
  source,
}: {
  conversationId: string;
  userId: string | null;
  source: BriefSource;
}): Promise<BriefRunResult> {
  const conversation = await loadConversationBriefContext(conversationId);

  if (!conversation) {
    return { ok: false, reason: "not_found", message: "Conversation not found." };
  }

  await prisma.productEvent.create({
    data: {
      type: ProductEventType.AI_INSIGHT_REQUESTED,
      userId,
      conversationId: conversation.id,
      metadata: {
        source,
        existingInsightCount: await prisma.conversationAiInsight.count({
          where: { conversationId: conversation.id },
        }),
      },
    },
  });

  if (!isAiOpsBriefConfigured()) {
    await prisma.productEvent.create({
      data: {
        type: ProductEventType.AI_INSIGHT_FAILED,
        userId,
        conversationId: conversation.id,
        metadata: { source, reason: "openai_not_configured" },
      },
    });

    return {
      ok: false,
      reason: "openai_not_configured",
      message: "AI is not configured. Add OPENAI_API_KEY to enable AI ops briefs.",
    };
  }

  const dealershipSettings = await prisma.dealershipSettings.findUnique({
    where: { id: "default" },
    select: { dealershipName: true },
  });
  const model = getAiOpsBriefModel();

  let brief;

  try {
    brief = await generateAiOpsBrief({
      dealershipName: dealershipSettings?.dealershipName ?? "CTX MotoWorks",
      conversation: {
        id: conversation.id,
        department: conversation.department,
        status: conversation.status,
        priority: conversation.priority,
        subject: truncateForAi(conversation.subject, MAX_SUBJECT_CHARS),
        customer: {
          name: truncateForAi(conversation.customer.name, 120) ?? conversation.customer.name,
          smsOptedOut: conversation.customer.smsOptedOut,
          notes: truncateForAi(conversation.customer.notes, MAX_CUSTOMER_NOTES_CHARS),
        },
        messages: [...conversation.messages].reverse().map((message) => ({
          direction: message.direction,
          body: truncateForAi(message.body, MAX_MESSAGE_BODY_CHARS) ?? "",
          deliveryStatus: message.deliveryStatus,
          createdAt: message.createdAt,
          senderName: truncateForAi(message.sender?.name ?? null, 120),
        })),
        tasks: conversation.tasks.map((task) => ({
          title: truncateForAi(task.title, MAX_TASK_TITLE_CHARS) ?? "",
          dueDate: task.dueDate,
          status: task.status,
          priority: task.priority,
        })),
      },
    });
  } catch (error) {
    const errorMessage = redactProviderSecrets(
      error instanceof Error ? error.message : "AI provider failed.",
    );

    await prisma.productEvent.create({
      data: {
        type: ProductEventType.AI_INSIGHT_FAILED,
        userId,
        conversationId: conversation.id,
        metadata: {
          source,
          reason: "provider_failure",
          message: errorMessage,
          model,
        },
      },
    });

    console.error("AI ops brief generation failed.", {
      conversationId: conversation.id,
      userId,
      source,
      model,
      error: errorMessage,
    });

    return {
      ok: false,
      reason: "provider_failure",
      message: "AI provider failed to generate a brief.",
    };
  }

  let insight: ConversationAiInsight;

  try {
    insight = await prisma.$transaction(async (tx) => {
      const createdInsight = await tx.conversationAiInsight.create({
        data: {
          conversationId: conversation.id,
          requestedByUserId: userId,
          model,
          summary: brief.summary,
          customerNeed: brief.customerNeed,
          riskLevel: brief.riskLevel,
          riskReasons: brief.riskReasons,
          escalationRecommended: brief.escalationRecommended,
          escalationReason: brief.escalationReason,
          suggestedDepartment: brief.suggestedDepartment,
          suggestedNextAction: brief.suggestedNextAction,
          suggestedReply: brief.suggestedReply,
          suggestedTaskTitle: brief.suggestedTaskTitle,
          confidence: brief.confidence,
        },
      });

      await tx.productEvent.create({
        data: {
          type: ProductEventType.AI_INSIGHT_GENERATED,
          userId,
          conversationId: conversation.id,
          aiInsightId: createdInsight.id,
          metadata: {
            source,
            model,
            riskLevel: createdInsight.riskLevel,
            escalationRecommended: createdInsight.escalationRecommended,
          },
        },
      });

      return createdInsight;
    });
  } catch (error) {
    // The brief was generated and paid for, so a failed write is recorded
    // rather than thrown: a pass over many conversations must count this one as
    // failed and keep going.
    console.error("AI ops brief persistence failed.", {
      conversationId: conversation.id,
      userId,
      source,
      model,
      error,
    });

    await prisma.productEvent
      .create({
        data: {
          type: ProductEventType.AI_INSIGHT_FAILED,
          userId,
          conversationId: conversation.id,
          metadata: { source, reason: "persist_failure", model },
        },
      })
      .catch((eventError) => {
        console.error("Failed to record AI ops brief persistence failure.", eventError);
      });

    return {
      ok: false,
      reason: "persist_failure",
      message: "AI brief generated but could not be saved.",
    };
  }

  return { ok: true, insight };
}
