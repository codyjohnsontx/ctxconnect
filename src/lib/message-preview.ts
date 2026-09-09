/**
 * Pure helpers for the one thing a queue row has to say about the text it
 * previews: whose words those are.
 *
 * The thread already answers this - every bubble is labelled "Internal note by
 * X", the sender's name, or the customer's name. The queue row is where the
 * advisor decides whether to open the thread at all, and it showed the newest
 * message of any direction with no attribution, so her own note and a staff
 * reply both read as something the customer just said.
 *
 * Nothing here touches the database, so the queue row and the search snippet
 * can share one rule and it can be tested on its own.
 */

import { MessageDirection } from "@/generated/prisma/client";

/** Which voice wrote the previewed text, for the row's styling. */
export type PreviewAuthor = "staff" | "note";

export type PreviewAttribution = {
  /** Rendered verbatim ahead of the preview: "You:", "Cody:", "Note:". */
  label: string;
  author: PreviewAuthor;
};

type AttributableMessage = {
  direction: MessageDirection;
  senderUserId?: string | null;
  sender?: { name?: string | null } | null;
};

/**
 * The first name alone. The row clamps to two lines and the customer's full
 * name is already on the line above, so a surname here spends the preview's
 * scarce width on the one part of the label that is never in doubt.
 */
function firstNameOf(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || null;
}

/**
 * How to introduce a previewed message, or null when it needs no introduction.
 *
 * An inbound message returns null on purpose. The customer's voice is what a
 * row is read as by default, and prefixing every customer message with their
 * own name - already in bold directly above - would spend the preview's width
 * to say nothing. Only the messages that are *not* the customer need a label,
 * which is exactly the confusion this exists to remove.
 */
export function previewAttribution(
  message: AttributableMessage | null | undefined,
  readerId: string | null | undefined,
): PreviewAttribution | null {
  if (!message || message.direction === MessageDirection.INBOUND) {
    return null;
  }

  // A blank id on either side is not a match: an outbound message whose sender
  // was deleted must not be read back as "You".
  const mine = Boolean(message.senderUserId) && message.senderUserId === readerId;
  const firstName = firstNameOf(message.sender?.name);

  if (message.direction === MessageDirection.INTERNAL) {
    // "Note from you" says less than "Note:" and costs more width - she knows
    // which notes are hers once she can see it is a note at all.
    return { label: mine || !firstName ? "Note:" : `Note from ${firstName}:`, author: "note" };
  }

  // "Staff" is the word the thread bubble already falls back to for a reply
  // whose sender no longer exists.
  return { label: mine ? "You:" : firstName ? `${firstName}:` : "Staff:", author: "staff" };
}
