import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { ProductEventType } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import {
  generateAiOpsBrief,
  getAiOpsBriefModel,
  isAiOpsBriefConfigured,
} from "@/lib/ai/ops-brief";
import { prisma } from "@/lib/prisma";
import { requireConversationAccess } from "@/lib/permissions";

const requestSchema = z.object({
  conversationId: z.string().min(1),
});

function accessErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === "Conversation not found.") {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (error instanceof Error && error.message === "Conversation access denied.") {
    return NextResponse.json({ error: "Conversation access denied." }, { status: 403 });
  }

  return null;
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
    const response = accessErrorResponse(error);

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
    include: {
      customer: true,
      assignedUser: true,
      tags: { include: { tag: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: true },
      },
      tasks: {
        orderBy: { dueDate: "asc" },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (session.user.isDemo) {
    const parsedLimit = Number(process.env.DEMO_AI_DAILY_LIMIT);
    const demoAiDailyLimit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 20;
    const requestedCount = await prisma.productEvent.count({
      where: {
        type: ProductEventType.AI_INSIGHT_REQUESTED,
        userId: session.user.id,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    if (requestedCount >= demoAiDailyLimit) {
      await prisma.productEvent.create({
        data: {
          type: ProductEventType.AI_INSIGHT_FAILED,
          userId: session.user.id,
          conversationId: conversation.id,
          metadata: {
            reason: "demo_cap",
            limit: demoAiDailyLimit,
          },
        },
      });

      return NextResponse.json(
        { error: "Demo limit reached: live AI briefs are capped for the shared demo and reset within 24 hours." },
        { status: 429 },
      );
    }
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
        subject: conversation.subject,
        customer: {
          name: conversation.customer.name,
          smsOptedOut: conversation.customer.smsOptedOut,
          notes: conversation.customer.notes,
        },
        messages: conversation.messages.map((message) => ({
          direction: message.direction,
          body: message.body,
          deliveryStatus: message.deliveryStatus,
          createdAt: message.createdAt,
          senderName: message.sender?.name ?? null,
        })),
        tasks: conversation.tasks.map((task) => ({
          title: task.title,
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
    const insight = await prisma.conversationAiInsight.create({
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

    await prisma.productEvent.create({
      data: {
        type: ProductEventType.AI_INSIGHT_GENERATED,
        userId: session.user.id,
        conversationId: conversation.id,
        aiInsightId: insight.id,
        metadata: {
          model,
          riskLevel: insight.riskLevel,
          escalationRecommended: insight.escalationRecommended,
        },
      },
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
