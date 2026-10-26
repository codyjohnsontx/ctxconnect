/**
 * The one way a text leaves Attend.
 *
 * This is the only module that imports the `twilio` package to send, and the
 * only caller of the gate in `src/lib/send-gate.ts` that can act on its answer.
 * `tests/single-send-path.test.ts` fails the build if a second Twilio client, a
 * second caller of `sendCustomerText`, or a forged `SendPermit` appears.
 *
 * The decision and the write it licenses happen in one transaction under the
 * customer's row lock - the lock the consent ledger's writer takes - so a STOP
 * landing in the webhook at the same instant is either in the ledger the gate
 * reads or waits for the send's row to commit; it cannot fall between them.
 * The narrow window between that commit and Twilio accepting the text is
 * Twilio's own STOP block, and when Twilio refuses with 21610 the carrier's
 * STOP becomes part of the ledger here.
 *
 * A refusal writes no `Message`: any outbound row after the customer's last
 * text counts as attending to them (`src/lib/sla.ts`), so a refused send that
 * left one would quietly clear their unanswered alert. It writes an `AuditLog`
 * row instead, with the reason and the body's length but not the body (owner
 * decision 10); the draft stays in the composer.
 *
 * The gate fails closed: if the ledger cannot be read, nothing is sent.
 */
import twilio from "twilio";
import {
  ConsentEventKind,
  ConsentMethod,
  DeliveryStatus,
  type Department,
  MessageDirection,
  MessageKind,
  NotificationType,
  type Priority,
  type Prisma,
} from "@/generated/prisma/client";
import { type ConsentState, classifyConsentReply, consentState } from "@/lib/consent";
import { lockCustomerConsent, recordConsentEvent } from "@/lib/consent-ledger";
import { dealershipTimeZone } from "@/lib/dealership-day";
import { getTwilioConfig } from "@/lib/env";
import { TEXTING_NOT_CONNECTED } from "@/lib/message-delivery";
import { notifyManagers, resolveConversationNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  CONTACT_WINDOW,
  type SendBlock,
  type SendDecision,
  type SendPermit,
  type SendRefusal,
  classifyOutbound,
  decideSend,
  describeRefusal,
  isSendPermit,
  refusalSentence,
} from "@/lib/send-gate";

/** Twilio's "Attempt to send to unsubscribed recipient": the carrier holds a STOP. */
export const TWILIO_UNSUBSCRIBED = 21610;

export const CONSENT_UNREADABLE =
  "Attend could not read this customer's consent record, so nothing was sent. Try again in a moment.";

export type SmsTransport = (message: { to: string; body: string }) => Promise<{ sid: string }>;

export type SendTarget = {
  userId: string;
  conversation: {
    id: string;
    customerId: string;
    department: Department;
    priority: Priority;
    customer: { name: string; phone: string };
  };
  body: string;
};

/** The route's response, as status and JSON body. */
export type SendOutcome = { status: number; payload: Record<string, unknown> };

/** Exists only for tests/send-gate.test.ts; the route never passes it. */
export type SendTestHooks = {
  /** Stands in for Twilio; null is texting not connected. */
  transport?: SmsTransport | null;
  /** Runs inside the transaction, under the customer's lock, before the ledger is read. */
  afterLock?: (tx: Prisma.TransactionClient) => Promise<void>;
};

type GateRead = { decision: SendDecision; consent: ConsentState };

/** Everything the gate reads for one send, from the ledger and the thread. */
async function readGate(
  db: Prisma.TransactionClient,
  target: { customerId: string; conversationId: string },
  now: Date,
): Promise<GateRead> {
  const consent = consentState(
    await db.consentEvent.findMany({
      where: { customerId: target.customerId },
      select: { id: true, channel: true, kind: true, method: true, occurredAt: true, createdAt: true },
    }),
  );
  const lastCustomerText = await db.message.findFirst({
    where: { direction: MessageDirection.INBOUND, conversation: { customerId: target.customerId } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const threadText = await db.message.findFirst({
    where: { conversationId: target.conversationId, direction: MessageDirection.INBOUND },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const threadReply = await db.message.findFirst({
    where: {
      conversationId: target.conversationId,
      direction: MessageDirection.OUTBOUND,
      deliveryStatus: { not: DeliveryStatus.FAILED },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const decision = decideSend({
    customerId: target.customerId,
    consent,
    lastCustomerTextAt: lastCustomerText?.createdAt ?? null,
    outbound: classifyOutbound({
      latestCustomerTextAt: threadText?.createdAt ?? null,
      latestReplyAt: threadReply?.createdAt ?? null,
      now,
    }),
    now,
    recipientTimeZone: dealershipTimeZone(),
    policy: CONTACT_WINDOW,
  });

  return { decision, consent };
}

async function blockFor(
  db: Prisma.TransactionClient,
  refusal: { reason: SendRefusal; opensAt: Date | null },
  consent: ConsentState,
  conversationId: string,
): Promise<SendBlock> {
  const awaitingReview =
    refusal.reason === "NO_CONSENT" &&
    (
      await db.message.findMany({
        where: { conversationId, direction: MessageDirection.INBOUND },
        select: { body: true },
      })
    ).some((text) => classifyConsentReply(text.body) === "REVIEW");

  return describeRefusal(refusal, { event: consent.event, awaitingReview });
}

/**
 * What the composer will be told if she presses Send, from the same reads the
 * send makes, for the thread page to render before she types. The send itself
 * decides again; this only saves her writing a text that cannot go.
 */
export async function previewSendBlock(target: { customerId: string; conversationId: string }) {
  const { decision, consent } = await readGate(prisma, target, new Date());

  return decision.allowed ? null : blockFor(prisma, decision, consent, target.conversationId);
}

async function auditBlocked(
  db: Prisma.TransactionClient,
  target: SendTarget,
  reason: SendRefusal,
  extra: Record<string, unknown> = {},
) {
  await db.auditLog.create({
    data: {
      userId: target.userId,
      action: "sms.send.blocked",
      entity: "Conversation",
      entityId: target.conversation.id,
      metadata: {
        reason,
        customerId: target.conversation.customerId,
        conversationId: target.conversation.id,
        bodyLength: target.body.length,
        ...extra,
      },
    },
  });
}

function refused(block: SendBlock): SendOutcome {
  return { status: 403, payload: { error: refusalSentence(block), reason: block.reason } };
}

function twilioTransport(): SmsTransport | null {
  const { accountSid, authToken, phoneNumber, messagingServiceSid, isConfigured } = getTwilioConfig();

  if (!isConfigured || !accountSid || !authToken) {
    return null;
  }

  const client = twilio(accountSid, authToken);

  return ({ to, body }) =>
    client.messages.create({
      body,
      to,
      ...(messagingServiceSid ? { messagingServiceSid } : { from: phoneNumber }),
    });
}

type SmsResult = { ok: true; sid: string } | { ok: false; carrierBlock: boolean; error: string };

/** Spends a permit. Not exported: `sendCustomerText` is the only way in. */
async function sendSms(permit: SendPermit, to: string, body: string, transport: SmsTransport): Promise<SmsResult> {
  if (!isSendPermit(permit)) {
    throw new Error("A text needs a permit from the send gate.");
  }

  try {
    const sent = await transport({ to, body });

    return { ok: true, sid: sent.sid };
  } catch (error) {
    return {
      ok: false,
      carrierBlock: (error as { code?: unknown } | null)?.code === TWILIO_UNSUBSCRIBED,
      error: error instanceof Error ? error.message : "Twilio send failed.",
    };
  }
}

/**
 * Twilio refused because the carrier holds a STOP Attend never saw. The text
 * did not go, so it is a refusal like any other - no Message row, an audit row
 * - and the STOP joins the ledger, dated when Attend learned it, so the next
 * send is refused before it reaches Twilio.
 */
async function recordCarrierBlock(target: SendTarget, messageId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.message.delete({ where: { id: messageId } });
    await lockCustomerConsent(tx, target.conversation.customerId);
    const [{ learnedAt }] = await tx.$queryRaw<Array<{ learnedAt: Date }>>`SELECT clock_timestamp() AS "learnedAt"`;
    const { event } = await recordConsentEvent(tx, {
      customerId: target.conversation.customerId,
      kind: ConsentEventKind.REVOKED,
      method: ConsentMethod.PROVIDER_BLOCK,
      occurredAt: learnedAt,
      providerRef: String(TWILIO_UNSUBSCRIBED),
    });
    await auditBlocked(tx, target, "REVOKED", { carrierBlock: true });

    return event;
  });
}

/**
 * Sends one reply on a conversation the caller has already authorised, or
 * refuses it. Returns the route's response.
 */
export async function sendCustomerText(target: SendTarget, hooks: SendTestHooks = {}): Promise<SendOutcome> {
  const { conversation, userId, body } = target;

  type Gated = { permit: SendPermit; messageId: string } | { block: SendBlock };
  let gated: Gated;

  try {
    gated = await prisma.$transaction(async (tx): Promise<Gated> => {
      await lockCustomerConsent(tx, conversation.customerId);
      await hooks.afterLock?.(tx);

      const { decision, consent } = await readGate(
        tx,
        { customerId: conversation.customerId, conversationId: conversation.id },
        new Date(),
      );

      if (!decision.allowed) {
        await auditBlocked(tx, target, decision.reason);

        return { block: await blockFor(tx, decision, consent, conversation.id) };
      }

      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderUserId: userId,
          direction: MessageDirection.OUTBOUND,
          kind: MessageKind.SMS,
          body,
          deliveryStatus: DeliveryStatus.QUEUED,
          consentEventId: decision.permit.consentEventId,
        },
      });

      return { permit: decision.permit, messageId: message.id };
    });
  } catch (error) {
    console.error("The send gate could not read the consent record; nothing was sent.", {
      conversationId: conversation.id,
      userId,
      error,
    });
    return { status: 503, payload: { error: CONSENT_UNREADABLE } };
  }

  if ("block" in gated) {
    return refused(gated.block);
  }

  const { permit, messageId } = gated;
  const transport = hooks.transport === undefined ? twilioTransport() : hooks.transport;

  // Compliance: production SMS traffic in the US requires approved A2P 10DLC
  // registration for the dealership brand/campaign before this route is used.
  if (!transport) {
    await prisma.message.update({
      where: { id: messageId },
      data: {
        deliveryStatus: DeliveryStatus.FAILED,
        errorMessage: TEXTING_NOT_CONNECTED,
      },
    });

    await notifyManagers({
      type: NotificationType.MESSAGE_FAILED,
      title: "Message failed",
      body: `${conversation.customer.name}: texting is not connected for the dealership.`,
      conversationId: conversation.id,
      messageId,
      department: conversation.department,
      subjectPriority: conversation.priority,
    });

    return { status: 503, payload: { error: TEXTING_NOT_CONNECTED } };
  }

  const sent = await sendSms(permit, conversation.customer.phone, body, transport);

  if (sent.ok) {
    await prisma.$transaction([
      prisma.message.update({
        where: { id: messageId },
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

    return { status: 200, payload: { ok: true, messageId, twilioSid: sent.sid } };
  }

  if (sent.carrierBlock) {
    const event = await recordCarrierBlock(target, messageId);

    return refused(describeRefusal({ reason: "REVOKED", opensAt: null }, { event, awaitingReview: false }));
  }

  await prisma.message.update({
    where: { id: messageId },
    data: {
      deliveryStatus: DeliveryStatus.FAILED,
      errorMessage: sent.error,
    },
  });

  await notifyManagers({
    type: NotificationType.MESSAGE_FAILED,
    title: "Message failed",
    body: `${conversation.customer.name}: ${sent.error}`,
    conversationId: conversation.id,
    messageId,
    department: conversation.department,
    subjectPriority: conversation.priority,
  });

  return { status: 502, payload: { error: sent.error } };
}
