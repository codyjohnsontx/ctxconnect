import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { AiInsightActionType, ProductEventType } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireConversationAccess } from "@/lib/permissions";

const actionSchema = z.object({
  action: z.enum([
    AiInsightActionType.ACCEPTED,
    AiInsightActionType.DISMISSED,
    AiInsightActionType.NOTE_CREATED,
    AiInsightActionType.FOLLOW_UP_CREATED,
    AiInsightActionType.REPLY_COPIED,
  ]),
});

const eventByAction = {
  [AiInsightActionType.ACCEPTED]: ProductEventType.AI_RECOMMENDATION_ACCEPTED,
  [AiInsightActionType.DISMISSED]: ProductEventType.AI_RECOMMENDATION_DISMISSED,
  [AiInsightActionType.NOTE_CREATED]: ProductEventType.AI_NOTE_CREATED,
  [AiInsightActionType.FOLLOW_UP_CREATED]: ProductEventType.AI_FOLLOW_UP_CREATED,
  [AiInsightActionType.REPLY_COPIED]: ProductEventType.AI_REPLY_COPIED,
} satisfies Record<Exclude<AiInsightActionType, "GENERATED">, ProductEventType>;

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
    },
  });

  if (!insight) {
    return NextResponse.json({ error: "AI insight not found." }, { status: 404 });
  }

  try {
    await requireConversationAccess(session.user, insight.conversationId);
  } catch (error) {
    if (error instanceof Error && error.message === "Conversation access denied.") {
      return NextResponse.json({ error: "Conversation access denied." }, { status: 403 });
    }

    if (error instanceof Error && error.message === "Conversation not found.") {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    console.error("Failed to authorize AI insight action.", {
      insightId,
      userId: session.user.id,
      error,
    });
    return NextResponse.json({ error: "Failed to load AI insight." }, { status: 500 });
  }

  const now = new Date();
  const updateData =
    parsed.data.action === AiInsightActionType.ACCEPTED
      ? { acceptedAt: now }
      : parsed.data.action === AiInsightActionType.DISMISSED
        ? { dismissedAt: now }
        : {};

  await prisma.$transaction([
    prisma.conversationAiInsight.update({
      where: { id: insight.id },
      data: updateData,
    }),
    prisma.productEvent.upsert({
      where: {
        type_aiInsightId: {
          type: eventByAction[parsed.data.action],
          aiInsightId: insight.id,
        },
      },
      update: {},
      create: {
        type: eventByAction[parsed.data.action],
        userId: session.user.id,
        conversationId: insight.conversationId,
        aiInsightId: insight.id,
        metadata: {
          action: parsed.data.action,
        },
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
