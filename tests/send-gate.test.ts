import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { type ConsentEventFacts, type ConsentState, consentState } from "../src/lib/consent";
import {
  ALWAYS_OPEN,
  CONTACT_WINDOW,
  type ContactWindowPolicy,
  REPLY_WINDOW_MS,
  type SendGateInput,
  type SendRefusal,
  classifyOutbound,
  decideSend,
  describeRefusal,
  isSendPermit,
  monthsBefore,
  refusalSentence,
} from "../src/lib/send-gate";
import * as sendGate from "../src/lib/send-gate";
import {
  ConsentChannel,
  ConsentEventKind,
  ConsentMethod,
  Department,
  MessageDirection,
  NotificationType,
  Role,
  SmsConsentStatus,
} from "../src/generated/prisma/enums";

// The send gate is the owner's rule as code: no recorded consent, after a STOP,
// a business-initiated text with no relationship in 18 months, or outside the
// contact window means no text, decided with no model involved. The first half
// pins the decision as a table. The second half drives the one send path
// against a real database: a refusal writes an audit row and no Message, a
// send names the grant it relied on, Twilio's 21610 becomes a revocation, and
// an unreadable ledger sends nothing.

const NOW = new Date("2026-10-20T15:00:00Z");

function event(kind: ConsentEventKind, occurredAt: Date | string, method?: ConsentMethod): ConsentEventFacts {
  const at = new Date(occurredAt);

  return {
    id: `event-${kind}-${at.getTime()}`,
    channel: ConsentChannel.SMS,
    kind,
    method:
      method ?? (kind === ConsentEventKind.GRANTED ? ConsentMethod.CUSTOMER_TEXTED_FIRST : ConsentMethod.KEYWORD_STOP),
    occurredAt: at,
    createdAt: at,
  };
}

const granted = (at: Date | string = "2026-10-01T12:00:00Z") => consentState([event(ConsentEventKind.GRANTED, at)]);
const revoked = consentState([
  event(ConsentEventKind.GRANTED, "2026-09-01T12:00:00Z"),
  event(ConsentEventKind.REVOKED, "2026-09-03T12:00:00Z"),
]);
const none = consentState([]);

const closedUntil =
  (opensAt: Date): ContactWindowPolicy =>
  () => ({ open: false, opensAt });
const NINE_AM = new Date("2026-10-21T14:00:00Z");

function input(overrides: Partial<SendGateInput> & { consent: ConsentState }): SendGateInput {
  return {
    customerId: "customer-1",
    lastCustomerTextAt: null,
    outbound: "INITIATED",
    now: NOW,
    recipientTimeZone: "America/Chicago",
    policy: ALWAYS_OPEN,
    ...overrides,
  };
}

function refusal(decision: ReturnType<typeof decideSend>) {
  return decision.allowed ? "ALLOWED" : decision.reason;
}

describe("decideSend", () => {
  const eighteenMonthsAgo = monthsBefore(NOW, 18);
  const justTooOld = new Date(eighteenMonthsAgo.getTime() - 1);

  const table: Array<[string, SendGateInput, SendRefusal | "ALLOWED"]> = [
    ["no event on record", input({ consent: none }), "NO_CONSENT"],
    ["no event on record, even as a reply", input({ consent: none, outbound: "REPLY" }), "NO_CONSENT"],
    ["a STOP", input({ consent: revoked }), "REVOKED"],
    ["a STOP, even as a reply", input({ consent: revoked, outbound: "REPLY" }), "REVOKED"],
    [
      "a STOP, with quiet hours closed too",
      input({ consent: revoked, policy: closedUntil(NINE_AM) }),
      "REVOKED",
    ],
    ["a recent grant, as a reply", input({ consent: granted(), outbound: "REPLY" }), "ALLOWED"],
    ["a recent grant, starting a conversation", input({ consent: granted() }), "ALLOWED"],
    ["a grant exactly 18 months old", input({ consent: granted(eighteenMonthsAgo) }), "ALLOWED"],
    ["a grant a moment past 18 months", input({ consent: granted(justTooOld) }), "LAPSED"],
    [
      "an old grant, but a customer text within 18 months",
      input({ consent: granted(justTooOld), lastCustomerTextAt: eighteenMonthsAgo }),
      "ALLOWED",
    ],
    [
      "an old grant and an old customer text",
      input({ consent: granted(justTooOld), lastCustomerTextAt: justTooOld }),
      "LAPSED",
    ],
    [
      "an old grant, as a reply to a text today",
      input({ consent: granted(justTooOld), outbound: "REPLY", lastCustomerTextAt: NOW }),
      "ALLOWED",
    ],
    [
      "starting a conversation with the window closed",
      input({ consent: granted(), policy: closedUntil(NINE_AM) }),
      "QUIET_HOURS",
    ],
    [
      "a reply with the window closed (owner decision 1b)",
      input({ consent: granted(), outbound: "REPLY", policy: closedUntil(NINE_AM) }),
      "ALLOWED",
    ],
    [
      "a lapsed relationship with the window closed",
      input({ consent: granted(justTooOld), policy: closedUntil(NINE_AM) }),
      "LAPSED",
    ],
  ];

  for (const [name, gateInput, expected] of table) {
    it(`${name}: ${expected}`, () => {
      assert.equal(refusal(decideSend(gateInput)), expected);
    });
  }

  it("says when quiet hours end", () => {
    const decision = decideSend(input({ consent: granted(), policy: closedUntil(NINE_AM) }));

    assert.deepEqual(decision, { allowed: false, reason: "QUIET_HOURS", opensAt: NINE_AM });
  });

  it("holds every send to an always-open window until quiet hours ship", () => {
    assert.equal(CONTACT_WINDOW, ALWAYS_OPEN);
    assert.deepEqual(CONTACT_WINDOW(new Date("2026-10-21T08:00:00Z"), "America/Chicago"), { open: true });
  });

  it("issues a permit naming the grant it rests on", () => {
    const consent = granted();
    const decision = decideSend(input({ consent, outbound: "REPLY" }));

    assert.ok(decision.allowed);
    assert.equal(decision.permit.consentEventId, consent.event?.id);
    assert.equal(decision.permit.customerId, "customer-1");
    assert.equal(decision.permit.outbound, "REPLY");
    assert.ok(isSendPermit(decision.permit));
    assert.ok(Object.isFrozen(decision.permit));
  });

  it("does not take a permit that was written out by hand", () => {
    const consent = granted();
    const decision = decideSend(input({ consent }));
    assert.ok(decision.allowed);

    const forged = {
      customerId: decision.permit.customerId,
      consentEventId: decision.permit.consentEventId,
      outbound: decision.permit.outbound,
      decidedAt: decision.permit.decidedAt,
    };

    assert.equal(isSendPermit(forged), false);
    assert.equal(isSendPermit(null), false);
    // The brand is a symbol the module keeps to itself.
    assert.equal(
      Object.values(sendGate).some((value) => typeof value === "symbol"),
      false,
    );
  });
});

describe("classifyOutbound", () => {
  const at = (iso: string) => new Date(iso);
  const textAt = at("2026-10-20T03:00:00Z");

  it("is a reply while the customer's newest text is unanswered and less than a day old", () => {
    assert.equal(classifyOutbound({ latestCustomerTextAt: textAt, latestReplyAt: null, now: NOW }), "REPLY");
    assert.equal(
      classifyOutbound({ latestCustomerTextAt: textAt, latestReplyAt: at("2026-10-19T03:00:00Z"), now: NOW }),
      "REPLY",
    );
    assert.equal(
      classifyOutbound({
        latestCustomerTextAt: textAt,
        latestReplyAt: null,
        now: new Date(textAt.getTime() + REPLY_WINDOW_MS),
      }),
      "REPLY",
    );
  });

  it("starts a conversation once the text is a day old, already answered, or there is none", () => {
    assert.equal(
      classifyOutbound({
        latestCustomerTextAt: textAt,
        latestReplyAt: null,
        now: new Date(textAt.getTime() + REPLY_WINDOW_MS + 1),
      }),
      "INITIATED",
    );
    assert.equal(classifyOutbound({ latestCustomerTextAt: textAt, latestReplyAt: textAt, now: NOW }), "INITIATED");
    assert.equal(
      classifyOutbound({ latestCustomerTextAt: textAt, latestReplyAt: at("2026-10-20T04:00:00Z"), now: NOW }),
      "INITIATED",
    );
    assert.equal(classifyOutbound({ latestCustomerTextAt: null, latestReplyAt: null, now: NOW }), "INITIATED");
  });
});

describe("monthsBefore", () => {
  it("counts calendar months in UTC and lands on the month's last day when the date does not exist", () => {
    assert.equal(monthsBefore(new Date("2026-10-20T15:00:00Z"), 18).toISOString(), "2025-04-20T15:00:00.000Z");
    assert.equal(monthsBefore(new Date("2027-08-31T10:00:00Z"), 18).toISOString(), "2026-02-28T10:00:00.000Z");
    assert.equal(monthsBefore(new Date("2029-08-31T10:00:00Z"), 18).toISOString(), "2028-02-29T10:00:00.000Z");
  });
});

describe("describeRefusal", () => {
  const stopAt = new Date("2026-09-03T12:00:00Z");

  it("dates a STOP and says how texting resumes", () => {
    const block = describeRefusal(
      { reason: "REVOKED", opensAt: null },
      { event: { method: ConsentMethod.KEYWORD_STOP, occurredAt: stopAt }, awaitingReview: false },
    );

    assert.equal(block.headline, "They replied STOP");
    assert.equal(block.at, stopAt);
    assert.match(block.instruction, /START from their phone/);
    assert.match(block.instruction, /call or email/);
  });

  it("names the carrier when Twilio holds the STOP", () => {
    const block = describeRefusal(
      { reason: "REVOKED", opensAt: null },
      { event: { method: ConsentMethod.PROVIDER_BLOCK, occurredAt: stopAt }, awaitingReview: false },
    );

    assert.match(block.headline, /carrier record shows a STOP/);
    assert.match(block.instruction, /START/);
  });

  it("dates any other opt-out without calling it a STOP reply", () => {
    const block = describeRefusal(
      { reason: "REVOKED", opensAt: null },
      { event: { method: ConsentMethod.BACKFILL_LEGACY_FLAG, occurredAt: stopAt }, awaitingReview: false },
    );

    assert.equal(block.headline, "They opted out");
    assert.equal(block.at, stopAt);
  });

  it("says a customer whose text may be a stop request is waiting on review, not that they never texted", () => {
    const waiting = refusalSentence(
      describeRefusal({ reason: "NO_CONSENT", opensAt: null }, { event: null, awaitingReview: true }),
    );
    const never = refusalSentence(
      describeRefusal({ reason: "NO_CONSENT", opensAt: null }, { event: null, awaitingReview: false }),
    );

    assert.match(waiting, /may be a stop request/);
    assert.match(waiting, /review/);
    assert.doesNotMatch(waiting, /starts the conversation/);
    assert.match(never, /No consent on record/);
  });

  it("explains a lapsed relationship and quiet hours", () => {
    assert.match(
      refusalSentence(describeRefusal({ reason: "LAPSED", opensAt: null }, { event: null, awaitingReview: false })),
      /18 months/,
    );
    const quiet = describeRefusal({ reason: "QUIET_HOURS", opensAt: NINE_AM }, { event: null, awaitingReview: false });
    assert.equal(quiet.opensAt, NINE_AM);
  });

  it("has words for every refusal", () => {
    const reasons: SendRefusal[] = ["NO_CONSENT", "REVOKED", "LAPSED", "QUIET_HOURS"];

    for (const reason of reasons) {
      const block = describeRefusal({ reason, opensAt: null }, { event: null, awaitingReview: false });
      assert.equal(block.reason, reason);
      assert.ok(block.headline && block.instruction, reason);
    }
  });
});

// The send path itself. It writes, so it runs only when TEST_DATABASE_URL names
// a migrated, disposable database; CI's build job points it at its throwaway
// Postgres. Consent events are never deleted and a customer with events cannot
// be (decision 7), so rows are suffixed rather than cleaned up.
const databaseUrl = process.env.TEST_DATABASE_URL;

type SmsSend = typeof import("../src/lib/sms-send");
type Ledger = typeof import("../src/lib/consent-ledger");
type InboundText = typeof import("../src/lib/inbound-text");
type Db = typeof import("../src/lib/prisma").prisma;

describe("the send path", { skip: !databaseUrl && "TEST_DATABASE_URL is not set" }, () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  let smsSend: SmsSend;
  let ledger: Ledger;
  let inboundText: InboundText;
  let prisma: Db;
  let advisorId: string;
  let count = 0;

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    smsSend = await import("../src/lib/sms-send");
    ledger = await import("../src/lib/consent-ledger");
    inboundText = await import("../src/lib/inbound-text");
    ({ prisma } = await import("../src/lib/prisma"));

    const advisor = await prisma.user.create({
      data: {
        name: `Send gate ${suffix}`,
        email: `send-gate-${suffix}@example.test`,
        passwordHash: "x",
        role: Role.SERVICE,
        department: Department.SERVICE,
      },
    });
    advisorId = advisor.id;
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  /** A customer who texted the store first, as the webhook records one. */
  async function customerWhoTexted(options: { consent: "granted" | "none" } = { consent: "granted" }) {
    count += 1;
    const phone = `+1555${suffix.slice(0, 4)}${String(count).padStart(3, "0")}`;
    const customer = await prisma.customer.create({ data: { name: `Send gate ${suffix} ${count}`, phone } });
    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, department: Department.SERVICE, assignedUserId: advisorId },
      include: { customer: true },
    });
    const text = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        body: "Is my bike ready?",
        deliveryStatus: "RECEIVED",
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    if (options.consent === "granted") {
      await prisma.$transaction((tx) =>
        ledger.recordConsentEvent(tx, {
          customerId: customer.id,
          kind: ConsentEventKind.GRANTED,
          method: ConsentMethod.CUSTOMER_TEXTED_FIRST,
          messageId: text.id,
          occurredAt: text.createdAt,
        }),
      );
    }

    return { customer, conversation, text };
  }

  function target(conversation: Awaited<ReturnType<typeof customerWhoTexted>>["conversation"], body = "Yes, ready at 3.") {
    return { userId: advisorId, conversation, body };
  }

  const mustNotSend = async (): Promise<{ sid: string }> => {
    throw new Error("Twilio was called for a send the gate should have refused.");
  };

  async function outboundRows(conversationId: string) {
    return prisma.message.findMany({ where: { conversationId, direction: MessageDirection.OUTBOUND } });
  }

  async function blockedAudits(conversationId: string) {
    return prisma.auditLog.findMany({ where: { action: "sms.send.blocked", entityId: conversationId } });
  }

  it("refuses a customer who replied STOP: 403, no Message, one audit row, the unanswered alert untouched", async () => {
    const { customer, conversation } = await customerWhoTexted();
    const stopAt = new Date();
    await prisma.$transaction(async (tx) => {
      const stop = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.INBOUND,
          body: "STOP",
          deliveryStatus: "RECEIVED",
          createdAt: stopAt,
        },
      });
      await ledger.recordConsentEvent(tx, {
        customerId: customer.id,
        kind: ConsentEventKind.REVOKED,
        method: ConsentMethod.KEYWORD_STOP,
        messageId: stop.id,
        occurredAt: stopAt,
      });
    });
    const alert = await prisma.notification.create({
      data: {
        type: NotificationType.SLA_MISSED,
        title: "Customer waiting",
        recipientUserId: advisorId,
        conversationId: conversation.id,
      },
    });

    const outcome = await smsSend.sendCustomerText(target(conversation, "Sorry to bother you"), { transport: mustNotSend });

    assert.equal(outcome.status, 403);
    assert.equal(outcome.payload.reason, "REVOKED");
    assert.match(String(outcome.payload.error), /START from their phone/);
    assert.deepEqual(await outboundRows(conversation.id), []);

    const audits = await blockedAudits(conversation.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].userId, advisorId);
    assert.equal(audits[0].entity, "Conversation");
    assert.deepEqual(audits[0].metadata, {
      reason: "REVOKED",
      customerId: customer.id,
      conversationId: conversation.id,
      bodyLength: "Sorry to bother you".length,
    });

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: alert.id } });
    assert.equal(after.status, alert.status);
    assert.equal(after.resolvedAt, null);

    const block = await smsSend.previewSendBlock({ customerId: customer.id, conversationId: conversation.id });
    assert.equal(block?.reason, "REVOKED");
    assert.equal(block?.headline, "They replied STOP");
    assert.equal(block?.at?.getTime(), stopAt.getTime());
    assert.match(block?.instruction ?? "", /START from their phone/);
  });

  it("refuses a customer with no consent on record the same way", async () => {
    const { conversation } = await customerWhoTexted({ consent: "none" });

    const outcome = await smsSend.sendCustomerText(target(conversation), { transport: mustNotSend });

    assert.equal(outcome.status, 403);
    assert.equal(outcome.payload.reason, "NO_CONSENT");
    assert.deepEqual(await outboundRows(conversation.id), []);
    assert.equal((await blockedAudits(conversation.id)).length, 1);
  });

  it("records on a sent text the grant it relied on", async () => {
    const { customer, conversation } = await customerWhoTexted();
    const handed: Array<{ to: string; body: string }> = [];

    const outcome = await smsSend.sendCustomerText(target(conversation), {
      transport: async (message) => {
        handed.push(message);
        return { sid: `SM${suffix}${count}` };
      },
    });

    assert.equal(outcome.status, 200);
    assert.deepEqual(handed, [{ to: customer.phone, body: "Yes, ready at 3." }]);

    const [sent] = await outboundRows(conversation.id);
    const cached = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(sent.deliveryStatus, "SENT");
    assert.ok(cached.smsConsentEventId);
    assert.equal(sent.consentEventId, cached.smsConsentEventId);
    assert.deepEqual(await blockedAudits(conversation.id), []);
  });

  it("names the grant even when texting is not connected", async () => {
    const { customer, conversation } = await customerWhoTexted();

    const outcome = await smsSend.sendCustomerText(target(conversation), { transport: null });

    assert.equal(outcome.status, 503);
    const [failed] = await outboundRows(conversation.id);
    const cached = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(failed.deliveryStatus, "FAILED");
    assert.equal(failed.consentEventId, cached.smsConsentEventId);
  });

  it("turns Twilio's 21610 into a recorded revocation and refuses the next send before Twilio", async () => {
    const { customer, conversation } = await customerWhoTexted();

    const outcome = await smsSend.sendCustomerText(target(conversation), {
      transport: async () => {
        throw Object.assign(new Error("Attempt to send to unsubscribed recipient"), { code: 21610, status: 400 });
      },
    });

    assert.equal(outcome.status, 403);
    assert.equal(outcome.payload.reason, "REVOKED");
    assert.match(String(outcome.payload.error), /carrier record shows a STOP/);
    assert.deepEqual(await outboundRows(conversation.id), []);

    const cached = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
      include: { smsConsentEvent: true },
    });
    assert.equal(cached.smsConsent, SmsConsentStatus.REVOKED);
    assert.equal(cached.smsConsentEvent?.method, ConsentMethod.PROVIDER_BLOCK);
    assert.equal(cached.smsConsentEvent?.kind, ConsentEventKind.REVOKED);
    assert.equal(cached.smsConsentEvent?.providerRef, "21610");
    assert.equal(cached.smsConsentEvent?.phone, customer.phone);

    const [audit] = await blockedAudits(conversation.id);
    assert.equal((audit.metadata as { carrierBlock?: boolean }).carrierBlock, true);

    const block = await smsSend.previewSendBlock({ customerId: customer.id, conversationId: conversation.id });
    assert.match(block?.headline ?? "", /carrier record shows a STOP/);

    const again = await smsSend.sendCustomerText(target(conversation), { transport: mustNotSend });
    assert.equal(again.status, 403);
    assert.equal((await blockedAudits(conversation.id)).length, 2);
  });

  it("tells her delivery is unknown, not that nothing went, when Twilio took the text but the write after failed", async () => {
    const { conversation } = await customerWhoTexted();
    let calls = 0;

    const outcome = await smsSend.sendCustomerText(target(conversation), {
      transport: async () => {
        calls += 1;
        // Twilio has accepted it; then the row the send would mark SENT is gone,
        // so the write recording the send throws.
        await prisma.message.deleteMany({ where: { conversationId: conversation.id, direction: MessageDirection.OUTBOUND } });
        return { sid: `SMlost${suffix}${count}` };
      },
    });

    assert.equal(calls, 1);
    assert.equal(outcome.status, 500);
    assert.equal(outcome.payload.deliveryUnknown, true);
    assert.equal(outcome.payload.error, smsSend.DELIVERY_UNKNOWN);
    assert.match(String(outcome.payload.error), /Delivery unknown/);
    assert.doesNotMatch(String(outcome.payload.error), /Nothing reached|was not sent/);

    // The composer clears the draft on that answer instead of inviting a second
    // press, and no longer claims nothing reached the customer when it has no reason.
    const composer = readFileSync(new URL("../src/components/message-composer.tsx", import.meta.url), "utf8");
    assert.match(composer, /if \(payload\?\.deliveryUnknown\) \{\s*commitDraft\(EMPTY_DRAFT\);/);
    assert.doesNotMatch(composer, /Nothing reached the customer/);
  });

  it("shows sending as blocked, never allowed, when the composer's preview cannot read the ledger", async () => {
    const { customer, conversation } = await customerWhoTexted();
    const thread = { customerId: customer.id, conversationId: conversation.id };
    const unreadable = {
      consentEvent: {
        findMany: async () => {
          throw new Error("Connection terminated unexpectedly");
        },
      },
    };

    assert.equal(await smsSend.previewSendBlock(thread), null);

    const block = await smsSend.previewSendBlock(thread, unreadable as never);
    assert.deepEqual(block, smsSend.PREVIEW_UNREADABLE);
    assert.equal(block?.reason, "UNREADABLE");
    assert.ok(block?.headline && block.instruction);
  });

  it("sends nothing when the ledger cannot be read", async () => {
    const { conversation } = await customerWhoTexted();
    // Another session holds the ledger table, and the send's transaction will
    // wait only briefly for it, so its read of the ledger throws.
    const holder = new Client({ connectionString: databaseUrl });
    await holder.connect();

    try {
      await holder.query("BEGIN");
      await holder.query('LOCK TABLE "ConsentEvent" IN ACCESS EXCLUSIVE MODE');

      const outcome = await smsSend.sendCustomerText(target(conversation), {
        transport: mustNotSend,
        afterLock: async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
        },
      });

      assert.equal(outcome.status, 503);
      assert.equal(outcome.payload.error, smsSend.CONSENT_UNREADABLE);
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }

    assert.deepEqual(await outboundRows(conversation.id), []);
    assert.deepEqual(await blockedAudits(conversation.id), []);
  });

  it("waits for a STOP that holds the customer's lock, then refuses", async () => {
    const { customer, conversation } = await customerWhoTexted();
    let stopHasLock!: () => void;
    let releaseStop!: () => void;
    const locked = new Promise<void>((resolve) => (stopHasLock = resolve));
    const released = new Promise<void>((resolve) => (releaseStop = resolve));

    const stop = prisma.$transaction((tx) =>
      inboundText.recordInboundText(
        tx,
        { from: customer.phone, body: "STOP", twilioSid: `SMstop${suffix}${count}`, mediaUrl: null, numMedia: 0 },
        async (point) => {
          if (point === "after-consent-lock") {
            stopHasLock();
            await released;
          }
        },
      ),
    );
    await locked;

    // Without the send taking the same lock, it would read the grant now, while
    // the STOP is still uncommitted, and write its row.
    const send = smsSend.sendCustomerText(target(conversation), { transport: mustNotSend });
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseStop();
    await stop;

    const outcome = await send;
    assert.equal(outcome.status, 403);
    assert.equal(outcome.payload.reason, "REVOKED");
    assert.deepEqual(await outboundRows(conversation.id), []);
  });
});
