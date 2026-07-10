import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { ProductEventType, TaskStatus } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import {
  generateAiOpsBrief,
  getAiOpsBriefModel,
  isAiOpsBriefConfigured,
} from "@/lib/ai/ops-brief";
import { prisma } from "@/lib/prisma";
import { requireConversationAccess } from "@/lib/permissions";
import { conversationAccessErrorResponse } from "@/lib/route-errors";

const requestSchema = z.object({
  conversationId: z.string().min(1),
});

const AI_CONTEXT_MESSAGE_DAYS = 90;
const AI_CONTEXT_TASK_LOOKBACK_DAYS = 30;
const MAX_AI_MESSAGES = 30;
const MAX_AI_TASKS = 12;
const MAX_SUBJECT_CHARS = 240;
const MAX_CUSTOMER_NOTES_CHARS = 800;
const MAX_MESSAGE_BODY_CHARS = 1400;
const MAX_TASK_TITLE_CHARS = 180;

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function truncateForAi(value: string | null, maxLength: number) {
  if (!value) {
    return value;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid AI ops brief payload." }, { status: 400 });
  }

  try {
    await requireConversationAccess(session.user, parsed.data.conversationId);
  } catch (error) {
    const response = conversationAccessErrorResponse(error);

    if (response) {
      return response;
    }

    console.error("Failed to authorize AI ops brief.", {
      conversationId: parsed.data.conversationId,
      userId: session.user.id,
      error,
    });
    return NextResponse.json({ error: "Failed to load conversation." }, { status: 500 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
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

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  await prisma.productEvent.create({
    data: {
      type: ProductEventType.AI_INSIGHT_REQUESTED,
      userId: session.user.id,
      conversationId: conversation.id,
      metadata: {
        source: "inbox",
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
        userId: session.user.id,
        conversationId: conversation.id,
        metadata: {
          reason: "openai_not_configured",
        },
      },
    });

    return NextResponse.json({ error: "AI is not configured. Add OPENAI_API_KEY to enable AI ops briefs." }, { status: 503 });
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
    const errorMessage = error instanceof Error ? error.message : "AI provider failed.";

    await prisma.productEvent.create({
      data: {
        type: ProductEventType.AI_INSIGHT_FAILED,
        userId: session.user.id,
        conversationId: conversation.id,
        metadata: {
          reason: "provider_failure",
          message: errorMessage,
          model,
        },
      },
    });

    console.error("AI ops brief generation failed.", {
      conversationId: conversation.id,
      userId: session.user.id,
      model,
      error,
    });

    return NextResponse.json({ error: "AI provider failed to generate a brief." }, { status: 502 });
  }

  try {
    const insight = await prisma.$transaction(async (tx) => {
      const createdInsight = await tx.conversationAiInsight.create({
        data: {
          conversationId: conversation.id,
          requestedByUserId: session.user.id,
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
          userId: session.user.id,
          conversationId: conversation.id,
          aiInsightId: createdInsight.id,
          metadata: {
            model,
            riskLevel: createdInsight.riskLevel,
            escalationRecommended: createdInsight.escalationRecommended,
          },
        },
      });

      return createdInsight;
    });

    return NextResponse.json({ insight });
  } catch (error) {
    console.error("Failed to persist AI ops brief.", {
      conversationId: conversation.id,
      userId: session.user.id,
      error,
    });

    return NextResponse.json({ error: "AI brief generated but could not be saved." }, { status: 500 });
  }
}
