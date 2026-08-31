import { NextResponse } from "next/server";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  MessageKind,
  NotificationType,
  OptInEventType,
  Prisma,
  PreferredContactMethod,
  Priority,
} from "@/generated/prisma/client";
import { placeholderCustomerName } from "@/lib/customer-identity";
import { isStartMessage, isStopMessage, normalizePhone } from "@/lib/phone";
import { notifyAssigneeTx, notifyManagersTx } from "@/lib/notifications";
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
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { phone: from },
        update: {},
        create: {
          // Shared with the profile card, which offers to replace exactly this
          // name and nothing else.
          name: placeholderCustomerName(from),
          phone: from,
          preferredContactMethod: PreferredContactMethod.SMS,
          smsOptedIn: true,
          optedInAt: new Date(),
        },
      });

      let optEvent: OptInEventType | null = null;

      if (isStopMessage(body)) {
        optEvent = OptInEventType.OPT_OUT;
        await tx.customer.update({
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
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            smsOptedIn: true,
            smsOptedOut: false,
            optedInAt: new Date(),
          },
        });
      }

      const conversation =
        (await tx.conversation.findFirst({
          where: {
            customerId: customer.id,
            status: { not: ConversationStatus.CLOSED },
          },
          orderBy: { lastMessageAt: "desc" },
        })) ??
        (await tx.conversation.create({
          data: {
            customerId: customer.id,
            department: Department.GENERAL,
            status: ConversationStatus.WAITING_ON_STAFF,
            unread: true,
          },
        }));

      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.INBOUND,
          kind: numMedia > 0 ? MessageKind.MMS : MessageKind.SMS,
          body,
          mediaUrl: mediaUrl || null,
          deliveryStatus: DeliveryStatus.RECEIVED,
          twilioSid,
        },
      });

      if (optEvent) {
        await tx.optInEvent.create({
          data: {
            customerId: customer.id,
            type: optEvent,
            source: "twilio",
            messageId: message.id,
          },
        });
      }

      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          unread: true,
          lastMessageAt: new Date(),
          status: ConversationStatus.WAITING_ON_STAFF,
        },
      });

      if (conversation.assignedUserId) {
        await notifyAssigneeTx(tx, {
          type: NotificationType.NEW_INBOUND_MESSAGE,
          title: "New customer message",
          body: `${customer.name}: ${body}`,
          recipientUserId: conversation.assignedUserId,
          conversationId: conversation.id,
          raisedByMessageId: message.id,
          department: conversation.department,
          priority: conversation.priority,
        });
      } else {
        await notifyManagersTx(tx, {
          type: NotificationType.UNASSIGNED_CONVERSATION,
          title: "New unassigned customer message",
          body: `${customer.name}: ${body}`,
          conversationId: conversation.id,
          raisedByMessageId: message.id,
          department: conversation.department,
          priority: Priority.HIGH,
        });
      }
    });
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
