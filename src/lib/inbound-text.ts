import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  MessageKind,
  NotificationType,
  PreferredContactMethod,
  type Prisma,
} from "@/generated/prisma/client";
import { inboundConsentEffect } from "@/lib/consent";
import { lockedConsentStatus, recordConsentEvent } from "@/lib/consent-ledger";
import { placeholderCustomerName } from "@/lib/customer-identity";
import { quotedCustomerText } from "@/lib/notification-facts";
import { notifyAssigneeTx, notifyManagersTx } from "@/lib/notifications";

export type InboundText = {
  /** E.164, already normalised. */
  from: string;
  body: string;
  twilioSid: string;
  mediaUrl: string | null;
  numMedia: number;
};

/**
 * Where a caller may hold the transaction to force an interleaving. Only the
 * database-backed consent suite passes one; the webhook never does.
 */
export type InboundTextPause = (point: "before-consent-lock" | "after-consent-lock") => Promise<void>;

/**
 * Everything one inbound text writes, in the caller's transaction: the customer
 * if Attend has not met them, the thread, the text, what it says about consent,
 * and the alert.
 *
 * Two texts from one customer are handled one after the other, in the order
 * they take the customer's row lock, and that same order has to decide both
 * what each text means and how the ledger orders the events. So the lock is
 * taken before anything is written, the status is read under it, and the
 * text's own time - which is the consent event's `occurredAt` - is read from
 * the database clock under it too. Classified against a status read before the
 * lock, or dated by a clock read before it, an ordinary text racing a STOP
 * could be recorded as texting first and outrank the STOP; owner decision 4
 * says an ordinary text after STOP never restores consent.
 */
export async function recordInboundText(tx: Prisma.TransactionClient, input: InboundText, pause?: InboundTextPause) {
  const customer = await tx.customer.upsert({
    where: { phone: input.from },
    update: {},
    create: {
      // Shared with the profile card, which offers to replace exactly this
      // name and nothing else.
      name: placeholderCustomerName(input.from),
      phone: input.from,
      preferredContactMethod: PreferredContactMethod.SMS,
    },
  });

  await pause?.("before-consent-lock");
  const consentBefore = await lockedConsentStatus(tx, customer.id);
  await pause?.("after-consent-lock");

  const [{ receivedAt }] = await tx.$queryRaw<Array<{ receivedAt: Date }>>`SELECT clock_timestamp() AS "receivedAt"`;

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
      kind: input.numMedia > 0 ? MessageKind.MMS : MessageKind.SMS,
      body: input.body,
      mediaUrl: input.mediaUrl,
      deliveryStatus: DeliveryStatus.RECEIVED,
      twilioSid: input.twilioSid,
      createdAt: receivedAt,
    },
  });

  // What this text says about consent, read against where the record stood
  // before it, and written in the transaction that stores the text so the
  // evidence and the event commit together. Attend replies to none of it:
  // Twilio's own STOP reply is the one confirmation the FCC allows.
  const consentEffect = inboundConsentEffect(consentBefore, input.body);

  if (consentEffect) {
    await recordConsentEvent(tx, {
      customerId: customer.id,
      ...consentEffect,
      messageId: message.id,
      occurredAt: message.createdAt,
      providerRef: input.twilioSid,
    });
  }

  await tx.conversation.update({
    where: { id: conversation.id },
    data: {
      unread: true,
      lastMessageAt: receivedAt,
      status: ConversationStatus.WAITING_ON_STAFF,
    },
  });

  if (conversation.assignedUserId) {
    await notifyAssigneeTx(tx, {
      type: NotificationType.NEW_INBOUND_MESSAGE,
      title: "New customer message",
      ...quotedCustomerText(customer.name, message),
      recipientUserId: conversation.assignedUserId,
      conversationId: conversation.id,
      department: conversation.department,
      subjectPriority: conversation.priority,
    });
  } else {
    await notifyManagersTx(tx, {
      type: NotificationType.UNASSIGNED_CONVERSATION,
      title: "New unassigned customer message",
      ...quotedCustomerText(customer.name, message),
      conversationId: conversation.id,
      department: conversation.department,
      // The thread's own rank, exactly as the sweep reads it. Hard-coding
      // HIGH here listed a LOW thread above every NORMAL alert on the rail.
      subjectPriority: conversation.priority,
    });
  }

  return { customer, message, consentEffect };
}
