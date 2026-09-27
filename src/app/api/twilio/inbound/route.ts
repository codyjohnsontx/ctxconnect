import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { recordInboundText } from "@/lib/inbound-text";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { logAuthenticatedTwilioPayloadIssue, verifyTwilioWebhook } from "@/lib/twilio";

export async function POST(request: Request) {
  const webhook = await verifyTwilioWebhook(request, "inbound");

  if (!webhook.ok) {
    return webhook.response;
  }

  const from = normalizePhone(webhook.get("From"));
  const body = webhook.get("Body");
  const twilioSid = webhook.get("MessageSid");
  const mediaUrl = webhook.get("MediaUrl0");
  const numMedia = Number(webhook.get("NumMedia") || 0);

  if (!twilioSid) {
    logAuthenticatedTwilioPayloadIssue("inbound", "missing-message-sid", {
      url: request.url,
      from,
    });
    return new NextResponse("ignored", { status: 200 });
  }

  const existingMessage = await prisma.message.findUnique({
    where: { twilioSid },
    select: { id: true },
  });

  if (existingMessage) {
    return new NextResponse("ok", { status: 200 });
  }

  if (!from || (!body && numMedia === 0)) {
    logAuthenticatedTwilioPayloadIssue("inbound", "incomplete-payload", {
      url: request.url,
      twilioSid,
      hasFrom: Boolean(from),
      hasBody: Boolean(body),
      numMedia,
    });
    return new NextResponse("ignored", { status: 200 });
  }

  try {
    await prisma.$transaction((tx) =>
      recordInboundText(tx, { from, body, twilioSid, mediaUrl: mediaUrl || null, numMedia }),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("twilioSid")
    ) {
      return new NextResponse("ok", { status: 200 });
    }

    throw error;
  }

  return new NextResponse("ok", { status: 200 });
}
