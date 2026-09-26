/**
 * Whether a customer may be texted, as a fact recorded rather than a flag
 * assumed.
 *
 * Consent is an append-only ledger of `ConsentEvent` rows: granted or revoked,
 * at a moment, by an act, with evidence. "May we text this number?" is a pure
 * function of that ledger, and it lives here, database-free, so the webhook,
 * the seed, the send route, the badges and the profile card all read one rule.
 * The owner's rule is that consent is plain code and never a judgement call, so
 * nothing in this module reads a model's output or a message's meaning beyond
 * a fixed word list.
 *
 * `Customer.smsConsent` caches `consentState` over that customer's events. Only
 * `recordConsentEvent` in `src/lib/consent-ledger.ts` writes an event, and it
 * rewrites the cache in the same transaction from this function, so the cache
 * cannot say anything the ledger does not.
 *
 * There is no default of "consented". A customer with no event is `NONE`, and
 * `NONE` is not textable.
 */
import { ConsentChannel, ConsentEventKind, ConsentMethod, SmsConsentStatus } from "@/generated/prisma/enums";

export type ConsentEventFacts = {
  id: string;
  channel: ConsentChannel;
  kind: ConsentEventKind;
  method: ConsentMethod;
  occurredAt: Date;
  createdAt: Date;
};

export type ConsentState<Event extends ConsentEventFacts = ConsentEventFacts> = {
  status: SmsConsentStatus;
  /** When the customer acted to put the record where it is; null for NONE. */
  since: Date | null;
  /** The event the status rests on; null for NONE. */
  event: Event | null;
};

/**
 * The latest event for the channel decides. "Latest" is when the customer
 * acted (`occurredAt`), not when the row was written, so a verbal consent
 * recorded this afternoon for a conversation at the counter last week does not
 * outrank a STOP they texted in between. Ties fall to the row written later,
 * then to the id, so the answer never depends on the order rows came back in.
 */
export function consentState<Event extends ConsentEventFacts>(
  events: readonly Event[],
  channel: ConsentChannel = ConsentChannel.SMS,
): ConsentState<Event> {
  let latest: Event | null = null;

  for (const event of events) {
    if (event.channel !== channel) {
      continue;
    }

    if (!latest || compareEvents(event, latest) > 0) {
      latest = event;
    }
  }

  if (!latest) {
    return { status: SmsConsentStatus.NONE, since: null, event: null };
  }

  return {
    status: latest.kind === ConsentEventKind.GRANTED ? SmsConsentStatus.GRANTED : SmsConsentStatus.REVOKED,
    since: latest.occurredAt,
    event: latest,
  };
}

/**
 * The state as the `Customer` row caches it, for a surface that reads the
 * cache rather than the ledger. `smsConsentEvent` is optional because a list
 * only needs the status; a card that says since when loads the event too.
 */
export function cachedConsentState<Event extends ConsentEventFacts>(customer: {
  smsConsent: SmsConsentStatus;
  smsConsentEvent?: Event | null;
}): ConsentState<Event> {
  const event = customer.smsConsentEvent ?? null;

  return {
    status: customer.smsConsent,
    since: customer.smsConsent === SmsConsentStatus.NONE ? null : (event?.occurredAt ?? null),
    event: customer.smsConsent === SmsConsentStatus.NONE ? null : event,
  };
}

function compareEvents(a: ConsentEventFacts, b: ConsentEventFacts) {
  return (
    a.occurredAt.getTime() - b.occurredAt.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

type MethodRule = {
  /** Which kinds an event of this method may carry. */
  kinds: readonly ConsentEventKind[];
  /** A person recorded it, so it must name them and say what the customer said or signed. */
  staffRecorded: boolean;
  /** How the badge and card finish "Texting allowed since ..." or "Opted out since ...". */
  reason: string;
};

const GRANTED_ONLY = [ConsentEventKind.GRANTED] as const;
const REVOKED_ONLY = [ConsentEventKind.REVOKED] as const;
const EITHER = [ConsentEventKind.GRANTED, ConsentEventKind.REVOKED] as const;

/**
 * Every method, classified. A `Record` over the enum, so a method added to the
 * schema does not compile until somebody decides what it may record and
 * whether a person has to vouch for it. The migration carries the same pairing
 * as CHECK constraints, so the database refuses what this refuses.
 */
export const consentMethodRules: Record<ConsentMethod, MethodRule> = {
  [ConsentMethod.CUSTOMER_TEXTED_FIRST]: { kinds: GRANTED_ONLY, staffRecorded: false, reason: "they texted first" },
  [ConsentMethod.KEYWORD_START]: { kinds: GRANTED_ONLY, staffRecorded: false, reason: "they replied START" },
  [ConsentMethod.KEYWORD_STOP]: { kinds: REVOKED_ONLY, staffRecorded: false, reason: "they replied STOP" },
  [ConsentMethod.STAFF_RECORDED_REQUEST]: {
    kinds: REVOKED_ONLY,
    staffRecorded: true,
    reason: "they asked staff to stop texting",
  },
  [ConsentMethod.VERBAL_AT_COUNTER]: { kinds: GRANTED_ONLY, staffRecorded: true, reason: "they agreed at the counter" },
  [ConsentMethod.WRITTEN_FORM]: { kinds: GRANTED_ONLY, staffRecorded: true, reason: "they signed a written form" },
  [ConsentMethod.PROVIDER_BLOCK]: {
    kinds: REVOKED_ONLY,
    staffRecorded: false,
    reason: "their carrier holds a STOP",
  },
  [ConsentMethod.STAFF_CORRECTION]: { kinds: EITHER, staffRecorded: true, reason: "corrected by staff" },
  [ConsentMethod.BACKFILL_FIRST_INBOUND]: { kinds: GRANTED_ONLY, staffRecorded: false, reason: "they texted first" },
  [ConsentMethod.BACKFILL_LEGACY_FLAG]: {
    kinds: REVOKED_ONLY,
    staffRecorded: false,
    reason: "they opted out before the consent record existed",
  },
  [ConsentMethod.SEED]: { kinds: EITHER, staffRecorded: false, reason: "demo data" },
};

export type ConsentTone = "green" | "red";

export type ConsentDescription = {
  status: SmsConsentStatus;
  tone: ConsentTone;
  /** The badge: two or three words. */
  label: string;
  /** Why, when there is an event to say it from. */
  reason: string | null;
  /** When; the caller prints it through `LocalTimestamp`, never on the server. */
  since: Date | null;
};

/**
 * The one description every surface shows, so the customers list, the thread
 * header and the profile card cannot disagree. The date is returned rather
 * than written into the sentence: a moment printed on the server is printed in
 * UTC (see `src/lib/dealership-day.ts`).
 */
export function describeConsent(state: Pick<ConsentState, "status" | "event">): ConsentDescription {
  const event = state.event;

  if (state.status === SmsConsentStatus.GRANTED) {
    return {
      status: state.status,
      tone: "green",
      label: "Texting allowed",
      reason: event ? consentMethodRules[event.method].reason : null,
      since: event?.occurredAt ?? null,
    };
  }

  if (state.status === SmsConsentStatus.REVOKED) {
    return {
      status: state.status,
      tone: "red",
      label: "Opted out",
      reason: event ? consentMethodRules[event.method].reason : null,
      since: event?.occurredAt ?? null,
    };
  }

  return { status: state.status, tone: "red", label: "No consent on record", reason: null, since: null };
}

/**
 * What the composer says when it will not send, or null when it will. A
 * customer with no consent whose texts were read as a possible stop request
 * has texted, so telling staff a text from them would start things is false.
 */
export function consentBlockMessage(status: SmsConsentStatus, customerTexts: readonly string[]): string | null {
  if (status === SmsConsentStatus.REVOKED) {
    return "This customer opted out. They must text START before staff can send again. Call or email in the meantime.";
  }

  if (status === SmsConsentStatus.NONE && customerTexts.some((body) => classifyConsentReply(body) === "REVIEW")) {
    return "Their text looks like it may be a stop request. A person needs to review it before the store can text them.";
  }

  if (status === SmsConsentStatus.NONE) {
    return "No consent on record, so Attend will not text this customer. A text from them to the store starts the conversation.";
  }

  return null;
}

/**
 * What an inbound text says about consent, by the words alone.
 *
 * - `REVOKE`: one of the FCC's per se revocation words (47 CFR 64.1200(a)(10):
 *   stop, quit, end, revoke, opt out, cancel, unsubscribe) or Twilio's STOPALL
 *   and OPTOUT, as the whole message.
 * - `GRANT`: START or UNSTOP as the whole message.
 * - `YES`: a re-subscribe only from an opted-out state (Twilio treats YES as
 *   START on long codes); anywhere else it is an ordinary "yes".
 * - `REVIEW`: a fixed phrase that may be a stop request in other words. It
 *   changes nothing on its own: a person decides, because "please don't stop
 *   working on the carb" must not end a relationship.
 * - `NONE`: an ordinary text.
 *
 * Matching is on the whole message after trimming, upper-casing, folding runs
 * of spaces, hyphens and underscores to one space, and dropping trailing
 * punctuation, so " Stop. ", "opt-out" and "STOP!!" count; a de minimis
 * variance must not defeat an opt-out.
 */
export type ConsentKeyword = "REVOKE" | "GRANT" | "YES" | "REVIEW" | "NONE";

export const REVOKE_KEYWORDS: readonly string[] = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
  "OPT OUT",
];

export const GRANT_KEYWORDS: readonly string[] = ["START", "UNSTOP"];

/**
 * Words that raise a review when they appear anywhere in a longer text. CANCEL,
 * END and QUIT are deliberately absent: they revoke as a whole message, but in
 * a service inbox "cancel my appointment" and "end of the day" are the
 * ordinary business of the day, and a review blocks the thread until somebody
 * answers it.
 */
export const REVIEW_WORDS: readonly string[] = ["STOP", "STOPALL", "UNSUBSCRIBE", "REVOKE", "OPTOUT", "OPT OUT"];

export const REVIEW_PHRASES: readonly string[] = [
  "DONT TEXT",
  "DON'T TEXT",
  "DO NOT TEXT",
  "NO MORE TEXTS",
  "REMOVE ME",
  "TAKE ME OFF",
  "WRONG NUMBER",
];

export function normalizeConsentReply(body: string) {
  return body
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/[\s.,!?;:'"]+$/, "")
    .trim();
}

export function classifyConsentReply(body: string): ConsentKeyword {
  const normalized = normalizeConsentReply(body);

  if (REVOKE_KEYWORDS.includes(normalized)) {
    return "REVOKE";
  }

  if (GRANT_KEYWORDS.includes(normalized)) {
    return "GRANT";
  }

  if (normalized === "YES") {
    return "YES";
  }

  // Word boundaries on the padded text, so "STOPPED BY" and "NONSTOP" do not
  // match STOP. Curly apostrophes are folded so "don’t text" reads like "don't".
  const padded = ` ${normalized.replace(/’/g, "'").replace(/[^A-Z0-9' ]+/g, " ").replace(/ +/g, " ")} `;

  if (
    REVIEW_WORDS.some((word) => padded.includes(` ${word} `)) ||
    REVIEW_PHRASES.some((phrase) => padded.includes(` ${phrase} `))
  ) {
    return "REVIEW";
  }

  return "NONE";
}

export type InboundConsentEffect = {
  kind: ConsentEventKind;
  method:
    | typeof ConsentMethod.KEYWORD_STOP
    | typeof ConsentMethod.KEYWORD_START
    | typeof ConsentMethod.CUSTOMER_TEXTED_FIRST;
};

/**
 * The event an inbound text writes, given where the record stands before it.
 *
 * - A stop word always revokes, and a START or UNSTOP always grants; a repeat
 *   is a fresh act and is recorded as one.
 * - YES grants only from `REVOKED`.
 * - An ordinary text from a customer with no consent on record is the customer
 *   texting first, and a reply to that is conversational.
 * - An ordinary text after a STOP does not restore anything: only START,
 *   UNSTOP, YES or a person recording consent does.
 * - A possible stop request in other words writes nothing here, and in
 *   particular does not count as texting first.
 */
export function inboundConsentEffect(current: SmsConsentStatus, body: string): InboundConsentEffect | null {
  const keyword = classifyConsentReply(body);

  if (keyword === "REVOKE") {
    return { kind: ConsentEventKind.REVOKED, method: ConsentMethod.KEYWORD_STOP };
  }

  if (keyword === "GRANT" || (keyword === "YES" && current === SmsConsentStatus.REVOKED)) {
    return { kind: ConsentEventKind.GRANTED, method: ConsentMethod.KEYWORD_START };
  }

  if (keyword !== "REVIEW" && current === SmsConsentStatus.NONE) {
    return { kind: ConsentEventKind.GRANTED, method: ConsentMethod.CUSTOMER_TEXTED_FIRST };
  }

  return null;
}
