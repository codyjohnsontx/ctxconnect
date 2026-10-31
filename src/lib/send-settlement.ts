/**
 * What a text stuck in `SENDING` turned out to be, decided from Twilio's own
 * list of messages to that number.
 *
 * A `SENDING` row is a text Attend handed to Twilio and never heard back
 * about: the answer was lost, the write recording it failed, or the process
 * died between the two. Twilio's status callback settles most of them; this
 * settles the rest, because while one stands the gate refuses every further
 * text on the thread. Sending is not idempotent and the Messages API takes no
 * idempotency key, so the only way to know whether the text went is to look.
 *
 * Twilio creates the message before it answers the create call, so a text it
 * has no record of after `SEND_SETTLEMENT_MS` never reached it. Until then
 * absence proves nothing, and the row is left for the next look. A sid another
 * row already holds is never claimed: the same words sent twice on purpose are
 * two texts, and the second must not take the first one's Twilio message.
 *
 * Database-free, so the rule is pinned as a table in
 * `tests/send-settlement.test.ts`. The lookup and the write live in
 * `src/lib/sms-send.ts`, the one module that talks to Twilio.
 */

/** How long a send may stand unconfirmed before Attend asks Twilio about it: a slow Twilio call plus the write. */
export const SEND_GRACE_MS = 30 * 1000;

/** How long after a send Twilio's having no record of it means it never arrived. */
export const SEND_SETTLEMENT_MS = 2 * 60 * 1000;

/** Clock difference tolerated between Attend writing the row and Twilio dating the message. */
export const SEND_CLOCK_SKEW_MS = 60 * 1000;

/**
 * How long the lookup may take before Attend gives up and leaves the send
 * standing. It sits in the thread page's render and in front of every send,
 * so a slow Twilio must not hold either for the SDK's own 30 seconds.
 */
export const TWILIO_LOOKUP_TIMEOUT_MS = 5 * 1000;

/** How many of Twilio's newest messages to the number are read. */
export const TWILIO_LOOKUP_LIMIT = 20;

/** The cause a send settled as never having reached Twilio is recorded with. */
export const NEVER_REACHED_TWILIO = "Did not reach Twilio: Twilio has no record of this text, so the customer never got it.";

export type UnconfirmedSend = { to: string; body: string; createdAt: Date };

/** The fields of one of Twilio's message records the match reads. */
export type TwilioMessage = { sid: string; to: string; body: string; direction: string; dateCreated: Date };

export type Settlement = { status: "SENT"; sid: string } | { status: "FAILED" } | { status: "WAIT" };

/** Whether the send has stood unconfirmed long enough to ask Twilio about it. */
export function needsSettling(send: Pick<UnconfirmedSend, "createdAt">, now: Date) {
  return now.getTime() - send.createdAt.getTime() >= SEND_GRACE_MS;
}

/**
 * `found` is Twilio's newest messages to the send's number; `heldSids` the
 * sids among them that another row already holds.
 */
export function settleSend(
  send: UnconfirmedSend,
  found: readonly TwilioMessage[],
  heldSids: ReadonlySet<string>,
  now: Date,
): Settlement {
  if (!needsSettling(send, now)) {
    return { status: "WAIT" };
  }

  const earliest = send.createdAt.getTime() - SEND_CLOCK_SKEW_MS;
  // The oldest match, because a later one with the same words is likelier to
  // be a later attempt than this one.
  const match = found
    .filter(
      (message) =>
        message.direction.startsWith("outbound") &&
        message.to === send.to &&
        message.body === send.body &&
        message.dateCreated.getTime() >= earliest &&
        !heldSids.has(message.sid),
    )
    .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime())[0];

  if (match) {
    return { status: "SENT", sid: match.sid };
  }

  return now.getTime() - send.createdAt.getTime() >= SEND_SETTLEMENT_MS ? { status: "FAILED" } : { status: "WAIT" };
}
