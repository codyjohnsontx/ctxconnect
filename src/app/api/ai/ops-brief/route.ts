import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { ProductEventType } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { generateAndSaveBrief } from "@/lib/ai/brief-runner";
import { remainingDemoBriefQuota } from "@/lib/ai/demo-cap";
import { prisma } from "@/lib/prisma";
import { requireConversationAccess } from "@/lib/permissions";
import { conversationAccessErrorResponse } from "@/lib/route-errors";

const requestSchema = z.object({
  conversationId: z.string().min(1),
});

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

  if (session.user.isDemo) {
    const { limit, remaining } = await remainingDemoBriefQuota(session.user.id);

    if (remaining <= 0) {
      await prisma.productEvent.create({
        data: {
          type: ProductEventType.AI_INSIGHT_FAILED,
          userId: session.user.id,
          conversationId: parsed.data.conversationId,
          metadata: {
            source: "inbox",
            reason: "demo_cap",
            limit,
          },
        },
      });

      return NextResponse.json(
        { error: "Demo limit reached: live AI briefs are capped for the shared demo and reset within 24 hours." },
        { status: 429 },
      );
    }
  }

  const result = await generateAndSaveBrief({
    conversationId: parsed.data.conversationId,
    userId: session.user.id,
    source: "inbox",
  });

  if (result.ok) {
    return NextResponse.json({ insight: result.insight });
  }

  const statusByReason = {
    not_found: 404,
    openai_not_configured: 503,
    provider_failure: 502,
    persist_failure: 500,
  } as const;

  return NextResponse.json({ error: result.message }, { status: statusByReason[result.reason] });
}
