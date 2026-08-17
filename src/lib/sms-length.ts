/**
 * The one length fact an advisor can act on: this reply is too long to send.
 *
 * The reply box and the send route have to agree about where that line is and
 * what to say when it is crossed, or she gets refused by one in words the other
 * never used. So the limit and the sentence live here.
 *
 * Deliberately not here: how many separate texts a reply arrives as. That is a
 * carrier-billing fact she cannot act on beyond "write less", and the box has
 * one line of attention to spend.
 */

/**
 * The longest reply Attend will send, counted the way the send route counts it
 * (UTF-16 code units, which is what a JavaScript string length is). Twilio
 * refuses beyond this, so the box has to refuse first and say so.
 */
export const SMS_BODY_LIMIT = 1600;

/**
 * How far past the limit this reply is, or 0 when it fits. Trimmed first because
 * the send route trims before it measures, so trailing whitespace must never be
 * what the box reports as over the line.
 */
export function smsOverBy(body: string): number {
  return Math.max(0, body.trim().length - SMS_BODY_LIMIT);
}

/** What the send route and the reply box both tell her when it is too long. */
export function smsTooLongMessage(over: number): string {
  return `That reply is ${over} ${over === 1 ? "character" : "characters"} too long to send as a text. Trim it to ${SMS_BODY_LIMIT} characters or fewer.`;
}
