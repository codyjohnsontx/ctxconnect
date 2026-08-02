import { NextResponse } from "next/server";
import { seedDemoData } from "@/lib/demo-seed";
import { prisma } from "@/lib/prisma";

// The seed regenerates its briefs through the real model when a key is set, so
// this needs the same headroom as the ambient pass rather than a plain-DB budget.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await seedDemoData(prisma);
    return NextResponse.json({ ok: true, seededAt: new Date().toISOString() });
  } catch (error) {
    console.error("Demo reseed failed.", error);
    return NextResponse.json({ error: "Demo reseed failed." }, { status: 500 });
  }
}
