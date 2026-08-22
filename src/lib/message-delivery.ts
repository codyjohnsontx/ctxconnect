/**
 * Pure helpers for the one message state the advisor must never misread: a
 * reply she wrote that the customer never received. The queue row, the thread
 * bubble, and the composer all have to agree about which message that is and
 * what to call it, so the rule lives here instead of in three components.
 */

import { DeliveryStatus, MessageDirection } from "@/generated/prisma/client";

/**
 * The failure the dealership can actually act on, written by the send route so
 * the API response and the stored message carry the same sentence. An advisor
 * cannot fix the connection herself, so this names who can rather than naming
 * the vendor or the environment variable behind it. It names no screen either:
 * Settings only reports the connection as a read-only health card, so sending
 * her there would promise a reconnect the product does not offer.
 */
export const TEXTING_NOT_CONNECTED =
  "Texting is not connected for this dealership, so no message can go out. An administrator can reconnect texting for the dealership.";

/**
 * What the advisor reads when nothing more specific is known. Carrier failures
 * and the Twilio status webhook both arrive as free-form vendor English, and
 * the outcome matters more to her than the wording of the cause.
 */
export const UNDELIVERED_HEADLINE = "Not delivered - the customer never got this.";

/**
 * The same fact at queue width. The row is a column beside the thread and its
 * preview already clamps to two lines, so it states the fact and leaves the
 * sentence to the bubble she opens. It says "reply" because the row marks the
 * conversation rather than the message it happens to be previewing, which is
 * often something written later.
 */
export const UNDELIVERED_ROW_LABEL = "Reply not delivered";

type DeliveryFacts = {
  direction: MessageDirection;
  deliveryStatus: DeliveryStatus;
};

/** True when staff wrote this message and it never reached the customer. */
export function isUndelivered(message: DeliveryFacts) {
  return message.direction === MessageDirection.OUTBOUND && message.deliveryStatus === DeliveryStatus.FAILED;
}

/**
 * The last thing staff sent the customer, whatever has been written since.
 * `messages` is the thread in the order it is displayed, oldest first.
 *
 * Deliberately not "the newest message": an inbound message or an internal note
 * written afterwards is not an attempt to reach the customer, so it is not the
 * one whose delivery is in question.
 */
export function newestReply<T extends DeliveryFacts>(messages: readonly T[]): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.direction === MessageDirection.OUTBOUND) {
      return message;
    }
  }

  return null;
}

/**
 * Whether this conversation is still carrying a reply the customer never got.
 * Takes {@link newestReply} - the newest OUTBOUND message, or null when staff
 * have never written to this customer.
 *
 * The input matters more than the rule. The queue row loads one message to
 * preview and it is the newest of *any* direction, so asking
 * {@link isUndelivered} about that one answers a different question: it marks
 * the row only while the failure happens to be the last word. An internal note
 * written after the failed reply takes over the preview and silently un-marks
 * the row, while the thread bubble and the composer banner both still say the
 * customer never got it. That is the queue lying on the one surface the advisor
 * scans to decide what to skip.
 *
 * Only the newest reply counts. A later inbound message or internal note does
 * not undo the failure - the customer is still waiting on something that was
 * never sent - but a later reply that did go out means she has moved past it.
 */
export function hasUndeliveredReply(reply: DeliveryFacts | null | undefined) {
  return Boolean(reply && isUndelivered(reply));
}

/**
 * The advisor's last attempt to say something, when it never left the building.
 * The message behind {@link hasUndeliveredReply}, for the callers that need to
 * put its text back in front of her rather than just flag it.
 */
export function lastUndeliveredOutbound<T extends DeliveryFacts>(messages: readonly T[]): T | null {
  const reply = newestReply(messages);

  return hasUndeliveredReply(reply) ? reply : null;
}

/**
 * The secondary line under {@link UNDELIVERED_HEADLINE}, or null when there is
 * nothing to add. The cause is passed through as recorded: the config failure
 * is our own sentence, and the rest is the carrier's own words, which already
 * read as a rejection and only stutter if we introduce them as one.
 */
export function undeliveredDetail(errorMessage?: string | null) {
  return errorMessage?.trim() || null;
}
