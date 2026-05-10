import { NextResponse } from "next/server";
import { DeliveryStatus, MessageDirection, NotificationType, Priority } from "@/generated/prisma/client";
import { notifyManagersTx, resolveConversationNotificationsTx } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { logAuthenticatedTwilioPayloadIssue, twilioStatusMap, verifyTwilioWebhook } from "@/lib/twilio";

export async function POST(request: Request) {
  const webhook = await verifyTwilioWebhook(request, "status");

  if (!webhook.ok) {
    return webhook.response;
  }

  const sid = webhook.get("MessageSid");
  const status = webhook.get("MessageStatus").toLowerCase();
  const errorMessage = webhook.get("ErrorMessage");

  if (!sid) {
    logAuthenticatedTwilioPayloadIssue("status", "missing-message-sid", {
      url: request.url,
      status,
    });
    return new NextResponse("ignored", { status: 200 });
  }

  if (!status || !(status in twilioStatusMap)) {
    logAuthenticatedTwilioPayloadIssue("status", "unrecognized-message-status", {
      url: request.url,
      twilioSid: sid,
      status,
    });
    return new NextResponse("ignored", { status: 200 });
  }

  const mappedStatus = twilioStatusMap[status];

  const message = await prisma.message.findUnique({
    where: { twilioSid: sid },
    include: {
      conversation: { include: { customer: true } },
    },
  });

  if (!message || message.direction !== MessageDirection.OUTBOUND || !message.conversation) {
    logAuthenticatedTwilioPayloadIssue("status", "unknown-message-sid", {
      url: request.url,
      twilioSid: sid,
      status,
    });
    return new NextResponse("ignored", { status: 200 });
  }

  const normalizedErrorMessage = errorMessage || null;
  const isUnchanged =
    message.deliveryStatus === mappedStatus && (message.errorMessage ?? null) === normalizedErrorMessage;

  if (isUnchanged) {
    return new NextResponse("ok", { status: 200 });
  }

  const enteredFailed = message.deliveryStatus !== DeliveryStatus.FAILED && mappedStatus === DeliveryStatus.FAILED;
  const enteredDelivered =
    message.deliveryStatus !== DeliveryStatus.DELIVERED && mappedStatus === DeliveryStatus.DELIVERED;

  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: mappedStatus,
        errorMessage: normalizedErrorMessage,
      },
    });

    if (enteredFailed) {
      await notifyManagersTx(tx, {
        type: NotificationType.MESSAGE_FAILED,
        title: "Message delivery failed",
        body: `${message.conversation.customer.name}: ${errorMessage || "Twilio reported delivery failure."}`,
        conversationId: message.conversationId,
        messageId: message.id,
        department: message.conversation.department,
        priority: Priority.HIGH,
      });
    } else if (enteredDelivered) {
      await resolveConversationNotificationsTx(tx, message.conversationId, [NotificationType.MESSAGE_FAILED]);
    }
  });

  return new NextResponse("ok", { status: 200 });
}
