import { ProductEventType, type Prisma } from "@/generated/prisma/client";
import type { BriefSource } from "@/lib/ai/brief-runner";
import { prisma } from "@/lib/prisma";

const DEFAULT_DEMO_AI_DAILY_LIMIT = 20;

/**
 * The event source the seed stamps on the briefs it writes.
 *
 * Deliberately not the insight's `model`: the seed regenerates those rows
 * through the real provider and overwrites that column. The event is rewritten
 * too, but its source is carried across, so this marker survives a reseed.
 */
const SEEDED_BRIEF_SOURCE: BriefSource = "seed";

export function demoAiDailyLimit() {
  const parsed = Number(process.env.DEMO_AI_DAILY_LIMIT);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DEMO_AI_DAILY_LIMIT;
}

/**
 * How many live briefs the shared demo account may still generate today.
 *
 * Counts successful, non-seeded generations only, so a provider outage or a
 * missing key never burns a visitor's quota. Seeded briefs are recognised by
 * their event's source, which survives the seed's regeneration pass.
 */
export async function remainingDemoBriefQuota(userId: string) {
  const limit = demoAiDailyLimit();
  const generatedToday = {
    type: ProductEventType.AI_INSIGHT_GENERATED,
    userId,
    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  } satisfies Prisma.ProductEventWhereInput;

  // Subtracted rather than filtered with a negated JSON path, because a negated
  // path also drops rows whose metadata never recorded a source at all.
  const [generatedCount, seededCount] = await Promise.all([
    prisma.productEvent.count({ where: generatedToday }),
    prisma.productEvent.count({
      where: { ...generatedToday, metadata: { path: ["source"], equals: SEEDED_BRIEF_SOURCE } },
    }),
  ]);

  const visitorCount = Math.max(0, generatedCount - seededCount);

  return { limit, remaining: Math.max(0, limit - visitorCount) };
}
