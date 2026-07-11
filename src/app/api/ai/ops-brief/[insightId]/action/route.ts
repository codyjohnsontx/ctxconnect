import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { AiInsightActionType, ProductEventType } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireConversationAccess } from "@/lib/permissions";
import { conversationAccessErrorResponse } from "@/lib/route-errors";

const actionSchema = z.object({
  action: z.enum([
    AiInsightActionType.ACCEPTED,
    AiInsightActionType.DISMISSED,
    AiInsightActionType.REPLY_COPIED,
  ]),
});

const eventByAction = {
  [AiInsightActionType.ACCEPTED]: ProductEventType.AI_RECOMMENDATION_ACCEPTED,
  [AiInsightActionType.DISMISSED]: ProductEventType.AI_RECOMMENDATION_DISMISSED,
  [AiInsightActionType.REPLY_COPIED]: ProductEventType.AI_REPLY_COPIED,
} satisfies Record<
  typeof AiInsightActionType.ACCEPTED | typeof AiInsightActionType.DISMISSED | typeof AiInsightActionType.REPLY_COPIED,
  ProductEventType
>;

type RouteContext = {
  params: Promise<{
    insightId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { insightId } = await context.params;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid AI insight action payload." }, { status: 400 });
  }

  const insight = await prisma.conversationAiInsight.findUnique({
    where: { id: insightId },
    select: {
      id: true,
      conversationId: true,
      acceptedAt: true,
      dismissedAt: true,
    },
  });

  if (!insight) {
    return NextResponse.json({ error: "AI insight not found." }, { status: 404 });
  }

  try {
    await requireConversationAccess(session.user, insight.conversationId);
  } catch (error) {
    const response = conversationAccessErrorResponse(error);

    if (response) {
      return response;
    }

    console.error("Failed to authorize AI insight action.", {
      insightId,
      userId: session.user.id,
      error,
    });
    return NextResponse.json({ error: "Failed to load AI insight." }, { status: 500 });
  }

  const action = parsed.data.action;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (action === AiInsightActionType.ACCEPTED) {
      await tx.conversationAiInsight.update({
        where: { id: insight.id },
        data: { acceptedAt: insight.acceptedAt ?? now, dismissedAt: null },
      });

      await tx.productEvent.deleteMany({
        where: {
          aiInsightId: insight.id,
          type: eventByAction[AiInsightActionType.DISMISSED],
        },
      });
    } else if (action === AiInsightActionType.DISMISSED) {
      await tx.conversationAiInsight.update({
        where: { id: insight.id },
        data: { acceptedAt: null, dismissedAt: insight.dismissedAt ?? now },
      });

      await tx.productEvent.deleteMany({
        where: {
          aiInsightId: insight.id,
          type: eventByAction[AiInsightActionType.ACCEPTED],
        },
      });
    }

    await tx.productEvent.upsert({
      where: {
        type_aiInsightId: {
          type: eventByAction[action],
          aiInsightId: insight.id,
        },
      },
      update: {},
      create: {
        type: eventByAction[action],
        userId: session.user.id,
        conversationId: insight.conversationId,
        aiInsightId: insight.id,
        metadata: {
          action,
        },
      },
    });
  });

  return NextResponse.json({ ok: true });
}
