import { Priority } from "@/generated/prisma/client";

export type RankableInsight = {
  riskLevel: Priority;
  escalationRecommended: boolean;
  dismissedAt: Date | null;
};

export type RankableConversation = {
  unread: boolean;
  priority: Priority;
  lastMessageAt: Date;
  aiInsights: RankableInsight[];
};

const riskWeight: Record<Priority, number> = {
  [Priority.URGENT]: 4,
  [Priority.HIGH]: 3,
  [Priority.NORMAL]: 2,
  [Priority.LOW]: 1,
};

/** An unbriefed thread is an unknown, not a safe one: it sorts as NORMAL. */
const UNBRIEFED_WEIGHT = riskWeight[Priority.NORMAL];

export function queueScore(conversation: RankableConversation) {
  const insight = conversation.aiInsights[0];

  if (!insight) {
    return UNBRIEFED_WEIGHT;
  }

  if (insight.dismissedAt) {
    // A dismissed brief stops shouting its AI risk, but dismissing the AI's
    // opinion must not erase the human's. The act of saying "I have seen this"
    // must not bury a genuinely urgent job below conversations the AI never
    // looked at, which is the opposite of what a ranked queue exists for. So
    // the thread falls back to what staff said, not to zero.
    return riskWeight[conversation.priority];
  }

  // Escalation is the strongest signal the model produces: it means this thread
  // needs someone beyond the advisor. It outranks risk level on its own.
  return riskWeight[insight.riskLevel] + (insight.escalationRecommended ? 10 : 0);
}

/**
 * Orders the inbox by what the AI decided matters, not by recency.
 *
 * Ties fall back to unread, then to the most recent activity, so two threads the
 * model rated the same still land in a stable, sensible order.
 */
export function rankConversationQueue<T extends RankableConversation>(conversations: T[]): T[] {
  return [...conversations].sort((a, b) => {
    const scoreDelta = queueScore(b) - queueScore(a);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    if (a.unread !== b.unread) {
      return a.unread ? -1 : 1;
    }

    return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });
}
