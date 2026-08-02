import { ProductEventType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_DEMO_AI_DAILY_LIMIT = 20;

export function demoAiDailyLimit() {
  const parsed = Number(process.env.DEMO_AI_DAILY_LIMIT);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DEMO_AI_DAILY_LIMIT;
}

/**
 * How many live briefs the shared demo account may still generate today.
 *
 * Counts successful, non-seeded generations only, so a provider outage or a
 * missing key never burns a visitor's quota.
 */
export async function remainingDemoBriefQuota(userId: string) {
  const limit = demoAiDailyLimit();
  const generatedCount = await prisma.productEvent.count({
    where: {
      type: ProductEventType.AI_INSIGHT_GENERATED,
      userId,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      aiInsight: { model: { not: "seeded-demo" } },
    },
  });

  return { limit, remaining: Math.max(0, limit - generatedCount) };
}
