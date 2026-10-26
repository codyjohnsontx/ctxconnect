/**
 * Whether a text may leave for a customer right now, decided by plain code.
 *
 * The owner's rule: no recorded consent, outside quiet hours, or after a STOP
 * reply means the send is blocked, with no model involved. This module is that
 * rule and nothing else. Its inputs are the consent ledger's answer, the
 * clock, the recipient's time zone, whether the text answers the customer or
 * starts something, and the contact-window policy. Nothing from the AI brief,
 * the draft or any model output is a parameter, and the signature is what
 * makes that visible in review.
 *
 * A yes is a `SendPermit`, and only `decideSend` can make one: the brand is a
 * symbol this module never exports, so another module can only forge a permit
 * by casting, which `tests/single-send-path.test.ts` refuses, and the sender
 * re-checks the brand at runtime with `isSendPermit`. The only thing that
 * spends a permit is `src/lib/sms-send.ts`, the one module that reaches Twilio.
 *
 * Database-free, so the decision can be pinned exhaustively by a table in
 * `tests/send-gate.test.ts`.
 */
import { ConsentMethod, SmsConsentStatus } from "@/generated/prisma/enums";
import type { ConsentEventFacts, ConsentState } from "@/lib/consent";

export type SendRefusal = "NO_CONSENT" | "REVOKED" | "LAPSED" | "QUIET_HOURS";

/**
 * `REPLY` answers a customer text from the last day that nobody has answered
 * yet; `INITIATED` is everything else, including a reply after a long silence.
 */
export type OutboundClass = "REPLY" | "INITIATED";

export type ContactWindow = { open: true } | { open: false; opensAt: Date };

/** When the store may start a conversation, in the recipient's local time. */
export type ContactWindowPolicy = (now: Date, timeZone: string) => ContactWindow;

export const ALWAYS_OPEN: ContactWindowPolicy = () => ({ open: true });

/**
 * The window every send is held to. Always open until quiet hours ship; owner
 * decision 11 keeps it a one-line setting, and this is the line.
 */
export const CONTACT_WINDOW: ContactWindowPolicy = ALWAYS_OPEN;

/** How long a customer text stays one a reply answers (owner decision 1b). */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How recent a grant or a customer text must be before the store may start a
 * conversation: the federal established-business-relationship period (owner
 * decision 6).
 */
export const RELATIONSHIP_MONTHS = 18;

const PERMIT = Symbol("SendPermit");

export type SendPermit = {
  readonly [PERMIT]: true;
  readonly customerId: string;
  /** The grant the text relies on; the sent row records it. */
  readonly consentEventId: string;
  readonly outbound: OutboundClass;
  readonly decidedAt: Date;
};

export function isSendPermit(value: unknown): value is SendPermit {
  return typeof value === "object" && value !== null && (value as { [PERMIT]?: unknown })[PERMIT] === true;
}

export type SendDecision =
  | { allowed: true; permit: SendPermit }
  | { allowed: false; reason: SendRefusal; opensAt: Date | null };

export type SendGateInput = {
  customerId: string;
  /** `consentState` over the customer's ledger, never the cached column. */
  consent: ConsentState;
  /** The customer's newest text to the store, on any thread. */
  lastCustomerTextAt: Date | null;
  outbound: OutboundClass;
  now: Date;
  recipientTimeZone: string;
  policy: ContactWindowPolicy;
};

/**
 * A text answers the customer while their newest text on this thread is newer
 * than the store's newest reply that did not fail, and no more than a day old.
 * A failed reply never reached them, so they are still waiting on an answer.
 */
export function classifyOutbound(thread: {
  latestCustomerTextAt: Date | null;
  latestReplyAt: Date | null;
  now: Date;
}): OutboundClass {
  const { latestCustomerTextAt, latestReplyAt, now } = thread;

  if (!latestCustomerTextAt || (latestReplyAt && latestReplyAt >= latestCustomerTextAt)) {
    return "INITIATED";
  }

  return now.getTime() - latestCustomerTextAt.getTime() <= REPLY_WINDOW_MS ? "REPLY" : "INITIATED";
}

/** The same wall-clock moment `months` calendar months earlier, in UTC, clamped to the month's last day. */
export function monthsBefore(now: Date, months: number) {
  const target = new Date(now.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));

  return target;
}

export function decideSend(input: SendGateInput): SendDecision {
  const { consent } = input;

  if (consent.status === SmsConsentStatus.REVOKED) {
    return { allowed: false, reason: "REVOKED", opensAt: null };
  }

  if (consent.status !== SmsConsentStatus.GRANTED || !consent.event) {
    return { allowed: false, reason: "NO_CONSENT", opensAt: null };
  }

  // A reply answers a text from the last day, so it is never stale and is
  // never held to the window. Only a text the store starts is.
  if (input.outbound === "INITIATED") {
    const cutoff = monthsBefore(input.now, RELATIONSHIP_MONTHS);
    const recentGrant = consent.event.occurredAt >= cutoff;
    const recentText = Boolean(input.lastCustomerTextAt && input.lastCustomerTextAt >= cutoff);

    if (!recentGrant && !recentText) {
      return { allowed: false, reason: "LAPSED", opensAt: null };
    }

    const window = input.policy(input.now, input.recipientTimeZone);

    if (!window.open) {
      return { allowed: false, reason: "QUIET_HOURS", opensAt: window.opensAt };
    }
  }

  const permit: SendPermit = Object.freeze({
    [PERMIT]: true as const,
    customerId: input.customerId,
    consentEventId: consent.event.id,
    outbound: input.outbound,
    decidedAt: input.now,
  });

  return { allowed: true, permit };
}

/**
 * What the composer says when it will not send. `at` is the moment the
 * headline is about, finished by the composer as "on <time>" through
 * `LocalTimestamp`, because a moment printed on the server is printed in UTC
 * (see `src/lib/dealership-day.ts`); `opensAt` is when quiet hours end.
 */
export type SendBlock = {
  reason: SendRefusal;
  headline: string;
  at: Date | null;
  instruction: string;
  opensAt: Date | null;
};

const RESUME_AFTER_STOP = "A START from their phone resumes texting; until then, call or email.";

export function describeRefusal(
  refusal: { reason: SendRefusal; opensAt: Date | null },
  context: {
    /** The event the consent state rests on. */
    event: Pick<ConsentEventFacts, "method" | "occurredAt"> | null;
    /** Whether a text of theirs was read as a possible stop request awaiting review. */
    awaitingReview: boolean;
  },
): SendBlock {
  const blank = { reason: refusal.reason, at: null, opensAt: null };

  switch (refusal.reason) {
    case "REVOKED": {
      const method = context.event?.method;

      if (method === ConsentMethod.PROVIDER_BLOCK) {
        return { ...blank, headline: "Their carrier record shows a STOP", instruction: RESUME_AFTER_STOP };
      }

      return {
        ...blank,
        headline: method === ConsentMethod.KEYWORD_STOP ? "They replied STOP" : "They opted out",
        at: context.event?.occurredAt ?? null,
        instruction: RESUME_AFTER_STOP,
      };
    }
    case "NO_CONSENT":
      return context.awaitingReview
        ? {
            ...blank,
            headline: "Their text looks like it may be a stop request",
            instruction: "A person needs to review it before the store can text them.",
          }
        : {
            ...blank,
            headline: "No consent on record, so Attend will not text this customer",
            instruction: "A text from them to the store starts the conversation.",
          };
    case "LAPSED":
      return {
        ...blank,
        headline: `They have not agreed to texts or texted the store in ${RELATIONSHIP_MONTHS} months`,
        instruction: "Attend will not start a conversation now. A text from them to the store opens it again.",
      };
    case "QUIET_HOURS":
      return {
        ...blank,
        headline: "It is outside texting hours for this customer",
        instruction: "The draft stays here until then.",
        opensAt: refusal.opensAt,
      };
  }
}

/** The block as one sentence, for a response body that has no clock to print `at` in. */
export function refusalSentence(block: SendBlock) {
  return `${block.headline}. ${block.instruction}`;
}
