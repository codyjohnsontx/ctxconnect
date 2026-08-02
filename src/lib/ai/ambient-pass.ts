import { ConversationStatus, MessageDirection, type Prisma } from "@/generated/prisma/client";
import { generateAndSaveBrief } from "@/lib/ai/brief-runner";
import { isAiOpsBriefConfigured, startBriefBudget } from "@/lib/ai/ops-brief";
import { prisma } from "@/lib/prisma";

/**
 * Ceiling on how many conversations one pass will brief. Every brief is a paid
 * model call, so the pass is bounded rather than unbounded-by-eligibility.
 *
 * This bounds cost, not time. startBriefBudget is what keeps the pass inside its
 * invocation, so raising this cannot overrun the budget.
 */
export const DEFAULT_MAX_BRIEFS_PER_PASS = 12;

export type AmbientPassResult = {
  status: "ok" | "not_configured";
  /** Conversations that needed a brief when the pass started. */
  eligible: number;
  briefed: number;
  failed: number;
  /**
   * Eligible conversations the pass never reached, because it hit its per-run
   * ceiling or ran out of time. Reported so a run that stops early says what it
   * did rather than looking like a run that did everything.
   */
  deferred: number;
};

export function maxBriefsPerPass() {
  const parsed = Number(process.env.AI_PASS_MAX_BRIEFS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_BRIEFS_PER_PASS;
}

/**
 * Whether a conversation's newest brief still describes its newest activity.
 *
 * Half of what "needs a brief" means. The other half is eligibility, which
 * `loadPassCandidates` decides, and both halves are read from here by everything
 * that reports on the pass.
 */
export function hasCurrentBrief(conversation: {
  lastMessageAt: Date;
  /** Newest first, so only the first entry decides freshness. */
  aiInsights: Array<{ createdAt: Date }>;
}) {
  const latestBriefAt = conversation.aiInsights[0]?.createdAt;

  return Boolean(latestBriefAt && latestBriefAt >= conversation.lastMessageAt);
}

/**
 * Every conversation the pass will consider: still live, and a customer has said
 * something in it. A thread outside this set is never briefed, so it is not part
 * of any count of what the pass has covered either.
 *
 * The one place this population is defined. The pass selects from it and the
 * inbox counts it, so the number on screen and the work the button does cannot
 * describe different sets of conversations.
 *
 * The scan is unbounded by design: every eligible conversation is loaded on each
 * pass, so no thread is ever out of reach. That is a known performance limit,
 * not a solved one, and it would need bounding if volume grew materially.
 */
async function loadPassCandidates(scope: Prisma.ConversationWhereInput = {}) {
  return prisma.conversation.findMany({
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
}

/**
 * A conversation needs a brief when the pass would consider it at all and
 * nothing has been briefed since its last activity.
 *
 * That second clause is what keeps the pass cheap: an unchanged thread is never
 * re-briefed, no matter how many times the pass runs. A thread re-enters the
 * queue only when a new message or note lands in it.
 *
 * The staleness clause compares two columns on different tables (the latest
 * insight's createdAt against the conversation's lastMessageAt), which Prisma
 * cannot express in a `where`, so it runs in JS over every candidate row.
 */
export async function findConversationsNeedingBrief(
  limit: number,
  scope: Prisma.ConversationWhereInput = {},
) {
  const candidates = await loadPassCandidates(scope);
  const stale = candidates.filter((conversation) => !hasCurrentBrief(conversation));

  return { eligible: stale, selected: stale.slice(0, limit) };
}

export type QueueBriefCoverage = {
  /** Conversations the pass will consider, which is what `briefed` is out of. */
  queueSize: number;
  briefed: number;
  lastBriefAt: Date | null;
};

/**
 * How much of a queue the pass has covered, counted over exactly the
 * conversations it would act on.
 *
 * A thread the pass will never brief, closed or with no inbound customer
 * message, is in neither number rather than counted as briefed, so the line this
 * feeds can always reach completion.
 */
export async function getQueueBriefCoverage(
  scope: Prisma.ConversationWhereInput = {},
): Promise<QueueBriefCoverage> {
  const candidates = await loadPassCandidates(scope);

  let briefed = 0;
  let lastBriefAt: Date | null = null;

  for (const conversation of candidates) {
    if (hasCurrentBrief(conversation)) {
      briefed += 1;
    }

    const briefedAt = conversation.aiInsights[0]?.createdAt;

    if (briefedAt && (!lastBriefAt || briefedAt > lastBriefAt)) {
      lastBriefAt = briefedAt;
    }
  }

  return { queueSize: candidates.length, briefed, lastBriefAt };
}

/**
 * Briefs every conversation that needs one, so the queue is ranked before an
 * advisor opens it rather than after she clicks a button on each thread.
 *
 * Runs on a schedule (`/api/ai/sweep`) and on demand from the inbox. Honest
 * about failure: a missing key or a provider outage leaves the thread unbriefed
 * and recorded as failed, and never writes a fabricated brief. Honest about
 * stopping early too: a pass that runs out of time returns the counts it earned
 * rather than letting the invocation die with them.
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
  // Started before the candidate scan, not after it: that scan is unbounded and
  // spends the same invocation the briefs do.
  const hasBudget = startBriefBudget();
  const limit = Math.max(0, maxBriefs ?? maxBriefsPerPass());

  if (!isAiOpsBriefConfigured()) {
    return { status: "not_configured", eligible: 0, briefed: 0, failed: 0, deferred: 0 };
  }

  const { eligible, selected } = await findConversationsNeedingBrief(limit, scope);

  let briefed = 0;
  let failed = 0;
  let reached = 0;

  for (const conversation of selected) {
    // Checked before the call rather than after it, because the deadline exists
    // to stop the invocation being killed with an unreported result.
    if (!hasBudget()) {
      console.warn("Ambient brief pass stopped at its time budget.", {
        briefed,
        failed,
        deferred: eligible.length - reached,
      });
      break;
    }

    reached += 1;

    // One conversation is allowed to fail for any reason, including one the
    // brief runner does not model, without costing every conversation behind it
    // in the sweep its brief. A throw counts as failed, like a provider failure.
    const result = await generateAndSaveBrief({
      conversationId: conversation.id,
      userId,
      source: "ambient_pass",
    }).catch((error) => {
      console.error("Ambient brief pass failed on a conversation.", {
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : error,
      });

      return null;
    });

    if (result?.ok) {
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
    deferred: Math.max(0, eligible.length - reached),
  };
}
