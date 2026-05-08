import { NextResponse } from "next/server";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  MessageKind,
  NotificationType,
  OptInEventType,
  PreferredContactMethod,
  Priority,
} from "@/generated/prisma/client";
import { isStartMessage, isStopMessage, normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { notifyAssignee, notifyManagers } from "@/lib/notifications";

export async function POST(request: Request) {
  const formData = await request.formData();
  const from = normalizePhone(String(formData.get("From") ?? ""));
  const body = String(formData.get("Body") ?? "").trim();
  const twilioSid = String(formData.get("MessageSid") ?? "");
  const mediaUrl = String(formData.get("MediaUrl0") ?? "");
  const numMedia = Number(formData.get("NumMedia") ?? 0);

  if (!from || !body) {
    return new NextResponse("ignored", { status: 200 });
  }

  const customer = await prisma.customer.upsert({
    where: { phone: from },
    update: {},
    create: {
      name: `Unknown ${from.slice(-4)}`,
      phone: from,
      preferredContactMethod: PreferredContactMethod.SMS,
      smsOptedIn: true,
      optedInAt: new Date(),
    },
  });

  let optEvent: OptInEventType | null = null;

  if (isStopMessage(body)) {
    optEvent = OptInEventType.OPT_OUT;
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        smsOptedIn: false,
        smsOptedOut: true,
        optedOutAt: new Date(),
      },
    });
  }

  if (isStartMessage(body)) {
    optEvent = OptInEventType.OPT_IN;
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        smsOptedIn: true,
        smsOptedOut: false,
        optedInAt: new Date(),
      },
    });
  }

  const conversation =
    (await prisma.conversation.findFirst({
      where: {
        customerId: customer.id,
        status: { not: ConversationStatus.CLOSED },
      },
      orderBy: { lastMessageAt: "desc" },
    })) ??
    (await prisma.conversation.create({
      data: {
        customerId: customer.id,
        department: Department.GENERAL,
        status: ConversationStatus.WAITING_ON_STAFF,
        unread: true,
      },
    }));

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      kind: numMedia > 0 ? MessageKind.MMS : MessageKind.SMS,
      body,
      mediaUrl: mediaUrl || null,
      deliveryStatus: DeliveryStatus.RECEIVED,
      twilioSid: twilioSid || null,
    },
  });

  if (optEvent) {
    await prisma.optInEvent.create({
      data: {
        customerId: customer.id,
        type: optEvent,
        source: "twilio",
        messageId: message.id,
      },
    });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      unread: true,
      lastMessageAt: new Date(),
      status: ConversationStatus.WAITING_ON_STAFF,
    },
  });

  if (conversation.assignedUserId) {
    await notifyAssignee({
      type: NotificationType.NEW_INBOUND_MESSAGE,
      title: "New customer message",
      body: `${customer.name}: ${body}`,
      recipientUserId: conversation.assignedUserId,
      conversationId: conversation.id,
      messageId: message.id,
      department: conversation.department,
      priority: conversation.priority,
    });
  } else {
    await notifyManagers({
      type: NotificationType.UNASSIGNED_CONVERSATION,
      title: "New unassigned customer message",
      body: `${customer.name}: ${body}`,
      conversationId: conversation.id,
      messageId: message.id,
      department: conversation.department,
      priority: Priority.HIGH,
    });
  }

  return new NextResponse("ok", { status: 200 });
}
