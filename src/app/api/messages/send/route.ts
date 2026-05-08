import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import twilio from "twilio";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DeliveryStatus, MessageDirection, MessageKind, NotificationType, Priority } from "@/generated/prisma/client";
import { notifyManagers, resolveConversationNotifications } from "@/lib/notifications";

const sendSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().trim().min(1).max(1600),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = sendSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message payload." }, { status: 400 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    include: { customer: true },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (conversation.customer.smsOptedOut) {
    return NextResponse.json({ error: "Customer has opted out of SMS." }, { status: 403 });
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderUserId: session.user.id,
      direction: MessageDirection.OUTBOUND,
      kind: MessageKind.SMS,
      body: parsed.data.body,
      deliveryStatus: DeliveryStatus.QUEUED,
    },
  });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  // Compliance: production SMS traffic in the US requires approved A2P 10DLC
  // registration for the dealership brand/campaign before this route is used.
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) {
    await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: DeliveryStatus.FAILED,
        errorMessage: "Twilio credentials are not configured.",
      },
    });

    await notifyManagers({
      type: NotificationType.MESSAGE_FAILED,
      title: "Message failed",
      body: `${conversation.customer.name}: Twilio credentials are not configured.`,
      conversationId: conversation.id,
      messageId: message.id,
      department: conversation.department,
      priority: Priority.HIGH,
    });

    return NextResponse.json({ error: "Twilio credentials are not configured." }, { status: 503 });
  }

  try {
    const client = twilio(accountSid, authToken);
    const sent = await client.messages.create({
      body: parsed.data.body,
      to: conversation.customer.phone,
      ...(messagingServiceSid ? { messagingServiceSid } : { from }),
    });

    await prisma.$transaction([
      prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: DeliveryStatus.SENT,
          twilioSid: sent.sid,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          unread: false,
        },
      }),
    ]);

    await resolveConversationNotifications(conversation.id, [NotificationType.SLA_MISSED]);

    return NextResponse.json({ ok: true, messageId: message.id, twilioSid: sent.sid });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Twilio send failed.";
    await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: DeliveryStatus.FAILED,
        errorMessage,
      },
    });

    await notifyManagers({
      type: NotificationType.MESSAGE_FAILED,
      title: "Message failed",
      body: `${conversation.customer.name}: ${errorMessage}`,
      conversationId: conversation.id,
      messageId: message.id,
      department: conversation.department,
      priority: Priority.HIGH,
    });

    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }
}
