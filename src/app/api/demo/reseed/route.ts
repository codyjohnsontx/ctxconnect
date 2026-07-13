import { NextResponse } from "next/server";
import { seedDemoData } from "@/lib/demo-seed";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

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
