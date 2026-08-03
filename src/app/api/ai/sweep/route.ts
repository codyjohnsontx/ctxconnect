import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { runAmbientBriefPass } from "@/lib/ai/ambient-pass";
import { demoStaleBriefCustomerPhone } from "@/lib/demo-fixtures";

export const maxDuration = 300;

/**
 * Leaves the curated demo fixture alone.
 *
 * The reseed rebuilds it once a day with a brief deliberately older than its
 * thread, and an unscoped sweep re-briefs that thread minutes later, so the
 * deployed demo spends the rest of the day showing the state the seed exists to
 * avoid. Running the sweep before the reseed instead would only shrink that to
 * the gap between the two crons, never to nothing, so the sweep skips the thread
 * rather than racing the reseed for it. A curated fixture is not new activity.
 * `Run pass` in the inbox is a person asking, so it still briefs it.
 *
 * Matched on the seeded customer rather than gated on a demo flag, because the
 * fixture's phone identifies it exactly and no environment has to be configured
 * for the exclusion to be correct. That phone is unique and non-null, so this
 * cannot silently drop a thread the way a filter over a nullable column would,
 * and a real dealership's threads are never in the set.
 */
const scheduledSweepScope: Prisma.ConversationWhereInput = {
  customer: { phone: { not: demoStaleBriefCustomerPhone } },
};

/**
 * Scheduled ambient AI pass. Briefs every conversation that has new activity
 * since its last brief, so the inbox is already ranked when staff arrive.
 *
 * Cron-only: authorized with CRON_SECRET, the same contract as /api/demo/reseed.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runAmbientBriefPass({ scope: scheduledSweepScope });
    return NextResponse.json({ ...result, ranAt: new Date().toISOString() });
  } catch (error) {
    console.error("Ambient AI brief pass failed.", error);
    return NextResponse.json({ error: "Ambient AI brief pass failed." }, { status: 500 });
  }
}
