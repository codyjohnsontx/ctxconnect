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

type DeliveryFacts = {
  direction: MessageDirection;
  deliveryStatus: DeliveryStatus;
};

/** True when staff wrote this message and it never reached the customer. */
export function isUndelivered(message: DeliveryFacts) {
  return message.direction === MessageDirection.OUTBOUND && message.deliveryStatus === DeliveryStatus.FAILED;
}

/**
 * The advisor's last attempt to say something, when it never left the building.
 * `messages` is the thread in the order it is displayed, oldest first.
 *
 * Only the newest outbound message counts. A later inbound message or internal
 * note does not undo the failure - the customer is still waiting on a reply
 * that was never sent - but a later outbound message that did go out means she
 * has already moved past it.
 */
export function lastUndeliveredOutbound<T extends DeliveryFacts>(messages: readonly T[]): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.direction !== MessageDirection.OUTBOUND) {
      continue;
    }

    return isUndelivered(message) ? message : null;
  }

  return null;
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
