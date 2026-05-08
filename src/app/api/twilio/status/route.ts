import { NextResponse } from "next/server";
import { DeliveryStatus, NotificationType, Priority } from "@/generated/prisma/client";
import { notifyManagers, resolveConversationNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const statusMap: Record<string, DeliveryStatus> = {
  queued: DeliveryStatus.QUEUED,
  sent: DeliveryStatus.SENT,
  delivered: DeliveryStatus.DELIVERED,
  failed: DeliveryStatus.FAILED,
  undelivered: DeliveryStatus.FAILED,
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const sid = String(formData.get("MessageSid") ?? "");
  const status = String(formData.get("MessageStatus") ?? "").toLowerCase();
  const errorMessage = String(formData.get("ErrorMessage") ?? "");

  if (!sid) {
    return new NextResponse("ignored", { status: 200 });
  }

  await prisma.message.updateMany({
    where: { twilioSid: sid },
    data: {
      deliveryStatus: statusMap[status] ?? DeliveryStatus.SENT,
      errorMessage: errorMessage || null,
    },
  });

  const message = await prisma.message.findUnique({
    where: { twilioSid: sid },
    include: {
      conversation: { include: { customer: true } },
    },
  });

  if (message?.conversation) {
    if (statusMap[status] === DeliveryStatus.FAILED) {
      await notifyManagers({
        type: NotificationType.MESSAGE_FAILED,
        title: "Message delivery failed",
        body: `${message.conversation.customer.name}: ${errorMessage || "Twilio reported delivery failure."}`,
        conversationId: message.conversationId,
        messageId: message.id,
        department: message.conversation.department,
        priority: Priority.HIGH,
      });
    } else if (statusMap[status] === DeliveryStatus.DELIVERED) {
      await resolveConversationNotifications(message.conversationId, [NotificationType.MESSAGE_FAILED]);
    }
  }

  return new NextResponse("ok", { status: 200 });
}
