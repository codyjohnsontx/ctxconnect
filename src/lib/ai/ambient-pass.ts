import { ConversationStatus, MessageDirection, type Prisma } from "@/generated/prisma/client";
import { generateAndSaveBrief } from "@/lib/ai/brief-runner";
import { isAiOpsBriefConfigured } from "@/lib/ai/ops-brief";
import { prisma } from "@/lib/prisma";

/**
 * Ceiling on how many conversations one pass will brief. Every brief is a paid
 * model call, so the pass is bounded rather than unbounded-by-eligibility.
 */
export const DEFAULT_MAX_BRIEFS_PER_PASS = 12;

export type AmbientPassResult = {
  status: "ok" | "not_configured";
  /** Conversations that needed a brief when the pass started. */
  eligible: number;
  briefed: number;
  failed: number;
  /** Eligible conversations left unbriefed because the pass hit its ceiling. */
  deferred: number;
};

function maxBriefsPerPass() {
  const parsed = Number(process.env.AI_PASS_MAX_BRIEFS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_BRIEFS_PER_PASS;
}

/**
 * A conversation needs a brief when it is still live, a customer has said
 * something in it, and nothing has been briefed since its last activity.
 *
 * That last clause is what keeps the pass cheap: an unchanged thread is never
 * re-briefed, no matter how many times the pass runs. A thread re-enters the
 * queue only when a new message or note lands in it.
 */
export async function findConversationsNeedingBrief(
  limit: number,
  scope: Prisma.ConversationWhereInput = {},
) {
  const candidates = await prisma.conversation.findMany({
    where: {
      AND: [
        scope,
        {
          status: { not: ConversationStatus.CLOSED },
          messages: { some: { direction: MessageDirection.INBOUND } },
        },
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      lastMessageAt: true,
      aiInsights: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const stale = candidates.filter((conversation) => {
    const latestBriefAt = conversation.aiInsights[0]?.createdAt;
    return !latestBriefAt || latestBriefAt < conversation.lastMessageAt;
  });

  return { eligible: stale, selected: stale.slice(0, limit) };
}

/**
 * Briefs every conversation that needs one, so the queue is ranked before an
 * advisor opens it rather than after she clicks a button on each thread.
 *
 * Runs on a schedule (`/api/ai/sweep`) and on demand from the inbox. Honest
 * about failure: a missing key or a provider outage leaves the thread unbriefed
 * and recorded as failed, and never writes a fabricated brief.
 */
export async function runAmbientBriefPass({
  userId = null,
  maxBriefs,
  scope,
}: {
  userId?: string | null;
  maxBriefs?: number;
  /** Restricts the pass to conversations the caller can see. The cron passes none. */
  scope?: Prisma.ConversationWhereInput;
} = {}): Promise<AmbientPassResult> {
  const limit = Math.max(0, maxBriefs ?? maxBriefsPerPass());

  if (!isAiOpsBriefConfigured()) {
    return { status: "not_configured", eligible: 0, briefed: 0, failed: 0, deferred: 0 };
  }

  const { eligible, selected } = await findConversationsNeedingBrief(limit, scope);

  let briefed = 0;
  let failed = 0;

  for (const conversation of selected) {
    const result = await generateAndSaveBrief({
      conversationId: conversation.id,
      userId,
      source: "ambient_pass",
    });

    if (result.ok) {
      briefed += 1;
    } else {
      failed += 1;
    }
  }

  return {
    status: "ok",
    eligible: eligible.length,
    briefed,
    failed,
    deferred: Math.max(0, eligible.length - selected.length),
  };
}
