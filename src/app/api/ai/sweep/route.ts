import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { runAmbientBriefPass } from "@/lib/ai/ambient-pass";
import { demoStaleBriefSubjects } from "@/lib/demo-seed";

export const maxDuration = 300;

/**
 * Leaves the curated demo fixtures alone.
 *
 * The reseed rebuilds them once a day with one brief deliberately older than its
 * thread, and an unscoped sweep re-briefs that thread minutes later, so the
 * deployed demo spends the rest of the day showing the state the seed exists to
 * avoid. Running the sweep before the reseed instead would only shrink that to
 * the gap between the two crons, never to nothing, so the sweep skips these
 * threads rather than racing the reseed for them. A curated fixture is not new
 * activity. `Run pass` in the inbox is a person asking, so it still briefs them.
 *
 * A null subject has to be admitted explicitly: `notIn` alone drops those rows,
 * and a thread with no subject is not a fixture.
 */
const scheduledSweepScope: Prisma.ConversationWhereInput = {
  OR: [{ subject: null }, { subject: { notIn: [...demoStaleBriefSubjects] } }],
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
