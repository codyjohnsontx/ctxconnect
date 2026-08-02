import { NextResponse } from "next/server";
import { runAmbientBriefPass } from "@/lib/ai/ambient-pass";

export const maxDuration = 300;

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
    const result = await runAmbientBriefPass();
    return NextResponse.json({ ...result, ranAt: new Date().toISOString() });
  } catch (error) {
    console.error("Ambient AI brief pass failed.", error);
    return NextResponse.json({ error: "Ambient AI brief pass failed." }, { status: 500 });
  }
}
