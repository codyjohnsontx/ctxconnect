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
 *
 * The row is written `SENDING` - handed to Twilio, outcome unknown - and only
 * Twilio's answer moves it on. While it stands the gate refuses the next text
 * on that thread, and the database holds a thread to one such row (the
 * partial index in `20261101090000_a_send_in_flight_is_its_own_state`),
 * because sending is not idempotent: a retry after an answer that never came
 * back can reach the customer twice. Twilio's status callback settles the row
 * by the id in its URL; `settleSendInFlight` settles the rest from Twilio's
 * list of messages, on the thread page and before the next send.
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
import {
  NEVER_REACHED_TWILIO,
  TWILIO_LOOKUP_LIMIT,
  TWILIO_LOOKUP_TIMEOUT_MS,
  type TwilioMessage,
  needsSettling,
  settleSend,
} from "@/lib/send-settlement";

/** Twilio's "Attempt to send to unsubscribed recipient": the carrier holds a STOP. */
export const TWILIO_UNSUBSCRIBED = 21610;

export const CONSENT_UNREADABLE =
  "Attend could not read this customer's consent record, so nothing was sent. Try again in a moment.";

/** Twilio accepted the text and the write recording that failed, so whether it arrived is not known here. */
export const DELIVERY_UNKNOWN =
  "Delivery unknown: Twilio accepted this text, but Attend could not record it as sent, so it may already have reached the customer. Attend will not send another text on this thread until it knows whether this one went.";

/** Twilio's answer never came back, and it creates the message before it answers, so it may have gone. */
export const TWILIO_DID_NOT_ANSWER =
  "Delivery unknown: Twilio did not answer while this text was being sent, so it may already have reached the customer. Attend will not send another text on this thread until it knows whether this one went.";

export type SmsTransport = (message: { to: string; body: string; statusCallback?: string }) => Promise<{ sid: string }>;

/** Twilio's newest messages to a number; it reads, and never sends. */
export type SmsLookup = (query: { to: string; limit: number }) => Promise<TwilioMessage[]>;

/**
 * Where Twilio reports this text's progress, naming the row so the webhook
 * can find it before Attend has recorded the sid - Twilio's first callback can
 * land before the write that would record it, and a write that fails leaves
 * no sid at all. Null when the app's URL is not configured: Twilio then falls
 * back to the Messaging Service's callback, which cannot carry the id.
 */
export function statusCallbackUrl(messageId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!appUrl) {
    return null;
  }

  try {
    const url = new URL("/api/twilio/status", appUrl);
    url.searchParams.set("messageId", messageId);

    return url.toString();
  } catch {
    return null;
  }
}

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
  /** Stands in for Twilio's message list; null is texting not connected. */
  lookup?: SmsLookup | null;
  /** Replaces `TWILIO_LOOKUP_TIMEOUT_MS`, so a test of the deadline need not wait it out. */
  lookupTimeoutMs?: number;
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
  const inFlight = await db.message.findFirst({
    where: {
      conversationId: target.conversationId,
      direction: MessageDirection.OUTBOUND,
      deliveryStatus: DeliveryStatus.SENDING,
    },
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
    sendInFlight: inFlight ? { since: inFlight.createdAt } : null,
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

/** What the composer shows when the preview could not read the gate's inputs. */
export const PREVIEW_UNREADABLE: SendBlock = {
  reason: "UNREADABLE",
  headline: "Attend could not read this customer's consent record",
  at: null,
  instruction: "Sending stays off until it can. Reload the page to try again.",
  opensAt: null,
};

/**
 * What the composer will be told if she presses Send, from the same reads the
 * send makes, for the thread page to render before she types. The send itself
 * decides again; this only saves her writing a text that cannot go.
 *
 * It fails closed and soft: a read that throws keeps the composer shut rather
 * than taking the thread page down with it, and never reads as allowed, which
 * is what `null` means. `db` exists only for tests/send-gate.test.ts.
 */
export async function previewSendBlock(
  target: { customerId: string; conversationId: string },
  db: Prisma.TransactionClient = prisma,
  hooks: Pick<SendTestHooks, "lookup" | "lookupTimeoutMs"> = {},
): Promise<SendBlock | null> {
  await settleSendInFlight(target.conversationId, hooks);

  try {
    const { decision, consent } = await readGate(db, target, new Date());

    return decision.allowed ? null : await blockFor(db, decision, consent, target.conversationId);
  } catch (error) {
    console.error("The send gate's preview could not read the consent record; sending is shown as blocked.", {
      conversationId: target.conversationId,
      error,
    });
    return PREVIEW_UNREADABLE;
  }
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

function twilioClient() {
  const { accountSid, authToken, isConfigured } = getTwilioConfig();

  return isConfigured && accountSid && authToken ? twilio(accountSid, authToken) : null;
}

function twilioTransport(): SmsTransport | null {
  const { phoneNumber, messagingServiceSid } = getTwilioConfig();
  const client = twilioClient();

  if (!client) {
    return null;
  }

  return ({ to, body, statusCallback }) =>
    client.messages.create({
      body,
      to,
      ...(statusCallback ? { statusCallback } : {}),
      ...(messagingServiceSid ? { messagingServiceSid } : { from: phoneNumber }),
    });
}

function twilioLookup(): SmsLookup | null {
  const client = twilioClient();

  if (!client) {
    return null;
  }

  // Newest first. Not filtered by DateSent: a message Twilio still has queued
  // may not have one, so the match compares dateCreated itself.
  return async ({ to, limit }) =>
    (await client.messages.list({ to, limit })).map((message) => ({
      sid: message.sid,
      to: message.to,
      body: message.body,
      direction: message.direction,
      dateCreated: message.dateCreated,
    }));
}

type SmsResult =
  | { ok: true; sid: string }
  | { ok: false; refused: true; carrierBlock: boolean; error: string }
  | { ok: false; refused: false; error: string };

/**
 * A connection that never opened - the host did not resolve, or it (or the
 * proxy) refused the connect - so no byte of the request reached Twilio.
 */
const NEVER_CONNECTED = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);

/**
 * Whether the text certainly did not go: Twilio answered with a 4xx - both of
 * the SDK's exceptions carry the HTTP status it got - or the request never
 * left. A timeout or a connection dropped after it opened carries no status,
 * and a 5xx can follow Twilio creating the message - sending is not idempotent
 * - so none of those proves anything, and calling them failed invites the same
 * text a second time.
 */
function isDefiniteRefusal(error: unknown) {
  const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };

  return (typeof status === "number" && status >= 400 && status < 500) || NEVER_CONNECTED.has(code as string);
}

/** Spends a permit. Not exported: `sendCustomerText` is the only way in. */
async function sendSms(
  permit: SendPermit,
  message: { to: string; body: string; messageId: string },
  transport: SmsTransport,
): Promise<SmsResult> {
  if (!isSendPermit(permit)) {
    throw new Error("A text needs a permit from the send gate.");
  }

  const statusCallback = statusCallbackUrl(message.messageId);

  try {
    const sent = await transport({ to: message.to, body: message.body, ...(statusCallback ? { statusCallback } : {}) });

    return { ok: true, sid: sent.sid };
  } catch (error) {
    const message = (error instanceof Error && error.message) || "Twilio send failed.";

    if (!isDefiniteRefusal(error)) {
      return { ok: false, refused: false, error: message };
    }

    return {
      ok: false,
      refused: true,
      carrierBlock: (error as { code?: unknown } | null)?.code === TWILIO_UNSUBSCRIBED,
      error: message,
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
  await prisma.$transaction(async (tx) => {
    await tx.message.delete({ where: { id: messageId } });
    await lockCustomerConsent(tx, target.conversation.customerId);
    const [{ learnedAt }] = await tx.$queryRaw<Array<{ learnedAt: Date }>>`SELECT clock_timestamp() AS "learnedAt"`;
    await recordConsentEvent(tx, {
      customerId: target.conversation.customerId,
      kind: ConsentEventKind.REVOKED,
      method: ConsentMethod.PROVIDER_BLOCK,
      occurredAt: learnedAt,
      providerRef: String(TWILIO_UNSUBSCRIBED),
    });
    await auditBlocked(tx, target, "REVOKED", { carrierBlock: true });
  });
}

/**
 * A text that did not go is marked so, and managers are told; the reply to her
 * says so either way. Only while it is still SENDING, so a send two callers
 * settle at once is reported once, and nothing Twilio has since said about it
 * is overwritten.
 */
async function recordFailedSend(conversation: SendTarget["conversation"], messageId: string, error: string, detail: string) {
  try {
    const { count } = await prisma.message.updateMany({
      where: { id: messageId, deliveryStatus: DeliveryStatus.SENDING },
      data: { deliveryStatus: DeliveryStatus.FAILED, errorMessage: error },
    });

    if (count === 0) {
      return;
    }

    await notifyManagers({
      type: NotificationType.MESSAGE_FAILED,
      title: "Message failed",
      body: `${conversation.customer.name}: ${detail}`,
      conversationId: conversation.id,
      messageId,
      department: conversation.department,
      subjectPriority: conversation.priority,
    });
  } catch (writeError) {
    console.error("A text that did not go could not be recorded as failed.", {
      conversationId: conversation.id,
      messageId,
      error: writeError,
    });
  }
}

/** `work`, or a rejection once `ms` have passed without it. */
async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms}ms.`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the SENT write does to the thread, for a reply whose SENT was recorded
 * later - by Twilio's callback or the reconciler - so it is not left unread or
 * out of place in the queue. Dated when the reply was written, and only while
 * nothing newer has landed: a customer text that arrived since keeps the
 * thread unread and its own place.
 */
export async function recordLateSentReply(
  db: Prisma.TransactionClient,
  reply: { conversationId: string; createdAt: Date },
) {
  await db.conversation.updateMany({
    where: { id: reply.conversationId, lastMessageAt: { lte: reply.createdAt } },
    data: { lastMessageAt: reply.createdAt, unread: false },
  });
}

/**
 * Settles the thread's `SENDING` row, if it has stood past the grace period,
 * from Twilio's list of messages to the customer: `SENT` with the sid when
 * Twilio has it, `FAILED` when Twilio still has no record of it once the
 * settlement bound has passed (`src/lib/send-settlement.ts`). Anything less
 * certain leaves it standing, and the gate keeps refusing: that is the
 * fail-closed answer, including when Twilio cannot be reached, does not
 * answer within `TWILIO_LOOKUP_TIMEOUT_MS`, or texting is not connected.
 * Never throws, because both callers go on to ask the gate.
 */
export async function settleSendInFlight(
  conversationId: string,
  hooks: Pick<SendTestHooks, "lookup" | "lookupTimeoutMs"> = {},
) {
  try {
    const now = new Date();
    const send = await prisma.message.findFirst({
      where: { conversationId, direction: MessageDirection.OUTBOUND, deliveryStatus: DeliveryStatus.SENDING },
      include: { conversation: { include: { customer: true } } },
    });

    if (!send || !needsSettling(send, now)) {
      return;
    }

    const lookup = hooks.lookup === undefined ? twilioLookup() : hooks.lookup;

    if (!lookup) {
      return;
    }

    const unconfirmed = { to: send.conversation.customer.phone, body: send.body, createdAt: send.createdAt };
    const found = await withDeadline(
      lookup({ to: unconfirmed.to, limit: TWILIO_LOOKUP_LIMIT }),
      hooks.lookupTimeoutMs ?? TWILIO_LOOKUP_TIMEOUT_MS,
      "Twilio's message list",
    );
    const held = await prisma.message.findMany({
      where: { twilioSid: { in: found.map((message) => message.sid) }, id: { not: send.id } },
      select: { twilioSid: true },
    });
    const settlement = settleSend(unconfirmed, found, new Set(held.map((row) => row.twilioSid ?? "")), now);

    if (settlement.status === "SENT") {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.message.updateMany({
          where: { id: send.id, deliveryStatus: DeliveryStatus.SENDING },
          data: { deliveryStatus: DeliveryStatus.SENT, twilioSid: settlement.sid },
        });

        if (count > 0) {
          await recordLateSentReply(tx, send);
        }
      });
    } else if (settlement.status === "FAILED") {
      await recordFailedSend(send.conversation, send.id, NEVER_REACHED_TWILIO, NEVER_REACHED_TWILIO);
    }
  } catch (error) {
    console.error("A text still being confirmed could not be settled; the thread stays held until it is.", {
      conversationId,
      error,
    });
  }
}

/**
 * Sends one reply on a conversation the caller has already authorised, or
 * refuses it. Returns the route's response.
 */
export async function sendCustomerText(target: SendTarget, hooks: SendTestHooks = {}): Promise<SendOutcome> {
  const { conversation, userId, body } = target;

  type Gated = { permit: SendPermit; messageId: string } | { block: SendBlock };
  let gated: Gated;

  // Outside the gate's transaction, because it may wait on Twilio; the gate
  // then reads whatever it left.
  await settleSendInFlight(conversation.id, hooks);

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
          deliveryStatus: DeliveryStatus.SENDING,
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
    await recordFailedSend(conversation, messageId, TEXTING_NOT_CONNECTED, "texting is not connected for the dealership.");

    return { status: 503, payload: { error: TEXTING_NOT_CONNECTED } };
  }

  const sent = await sendSms(permit, { to: conversation.customer.phone, body, messageId }, transport);

  if (sent.ok) {
    try {
      await prisma.$transaction([
        // Only while it is still SENDING: Twilio's callback can land first and
        // has already said more - delivered, or undelivered - than SENT does.
        prisma.message.updateMany({
          where: { id: messageId, deliveryStatus: DeliveryStatus.SENDING },
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
    } catch (error) {
      // Twilio has the text, so "not sent" would be a lie that invites her to
      // send it twice. The row stays SENDING, which refuses the next text on
      // the thread until it is settled.
      console.error("Twilio accepted a text but Attend could not record it as sent.", {
        conversationId: conversation.id,
        messageId,
        twilioSid: sent.sid,
        error,
      });
      return { status: 500, payload: { error: DELIVERY_UNKNOWN, deliveryUnknown: true, messageId } };
    }

    // The text went and is recorded; a stale alert is not worth telling her otherwise.
    await resolveConversationNotifications(conversation.id, [NotificationType.SLA_MISSED]).catch((error) => {
      console.error("A sent text could not clear the thread's unanswered alert.", { conversationId: conversation.id, error });
    });

    return { status: 200, payload: { ok: true, messageId, twilioSid: sent.sid } };
  }

  if (!sent.refused) {
    // Like the failed write above: the row stays SENDING, because FAILED would
    // tell her the customer never got it and offer to send it again.
    console.error("Twilio did not answer a send, so whether the text went is not known.", {
      conversationId: conversation.id,
      messageId,
      error: sent.error,
    });
    return { status: 500, payload: { error: TWILIO_DID_NOT_ANSWER, deliveryUnknown: true, messageId } };
  }

  if (sent.carrierBlock) {
    await recordCarrierBlock(target, messageId).catch(async (error) => {
      console.error("Twilio refused a text for a carrier STOP and Attend could not record the STOP.", {
        conversationId: conversation.id,
        messageId,
        error,
      });
      await prisma.message.delete({ where: { id: messageId } }).catch((deleteError) => {
        console.error("A text the carrier refused could not be removed from the thread.", {
          conversationId: conversation.id,
          messageId,
          error: deleteError,
        });
      });
      await auditBlocked(prisma, target, "REVOKED", { carrierBlock: true, stopRecorded: false }).catch((auditError) => {
        console.error("A text the carrier refused could not be audited.", {
          conversationId: conversation.id,
          messageId,
          error: auditError,
        });
      });
    });

    return refused(
      describeRefusal(
        { reason: "REVOKED", opensAt: null },
        { event: { method: ConsentMethod.PROVIDER_BLOCK, occurredAt: new Date() }, awaitingReview: false },
      ),
    );
  }

  await recordFailedSend(conversation, messageId, sent.error, sent.error);

  return { status: 502, payload: { error: sent.error } };
}
