/**
 * Coverage: who is holding an advisor's open conversations while she is away,
 * and what happens to each of them when she comes back.
 *
 * Four surfaces have to agree about this and they cannot each decide for
 * themselves. The coverage board renders a picker of who may cover; the server
 * action re-checks the name that comes back; the board decides whose buttons to
 * show; and the action that ends coverage decides, thread by thread, whether it
 * goes back. A board offering a name the action refuses turns one click into an
 * error page, and a return rule written twice is the one most likely to drift -
 * it runs once per advisor per trip, so nothing on screen would show it had.
 *
 * Kept free of the database client so every rule here can be tested directly
 * and read by a component that renders in the browser, the same way
 * conversation-access.ts and task-access.ts hold the matching rules for threads
 * and follow-ups. The enums come from the generated `enums` module rather than
 * `client`, which drags the Prisma runtime into the browser bundle and fails to
 * build.
 */

import type { Prisma } from "@/generated/prisma/client";
import { ConversationStatus, MessageDirection, Role } from "@/generated/prisma/enums";
import type { AppUser } from "@/lib/data";

/** The conversations coverage moves: everything that is not finished. */
export const openConversationStatuses = [
  ConversationStatus.OPEN,
  ConversationStatus.WAITING_ON_CUSTOMER,
  ConversationStatus.WAITING_ON_STAFF,
  ConversationStatus.FOLLOW_UP_NEEDED,
] as const;

/**
 * The one clause that says "still open", so the count on the board and the rows
 * the hand-off actually moves cannot disagree. Written as the statuses that are
 * open rather than as `not: CLOSED`, so a status added to the enum later has to
 * be placed here deliberately instead of silently joining the hand-off.
 *
 * Closed history is deliberately left alone: a thread somebody finished stays
 * attributed to whoever finished it, whatever happens to their account
 * afterwards.
 */
export const openConversationWhere = {
  status: { in: [...openConversationStatuses] },
} satisfies Prisma.ConversationWhereInput;

/** How coverage ends, and therefore whether it can end at all. */
export type CoverageKind = "temporary" | "permanent";

export const coverageKinds: readonly CoverageKind[] = ["temporary", "permanent"];

export function parseCoverageKind(value: string): CoverageKind | null {
  return coverageKinds.includes(value as CoverageKind) ? (value as CoverageKind) : null;
}

/** An account as the coverage rules need to read it. */
export type CoverageAccount = {
  id: string;
  active: boolean;
  /** Who is already holding this account's conversations, if anyone. */
  coveredByUserId: string | null;
};

/**
 * Why this person cannot be handed somebody else's conversations, or null when
 * they can.
 *
 * Returned as the sentence rather than as a boolean because the server action
 * refuses the hand-off with it. The board never shows these: it filters its
 * picker through `canCover`, so a name that reaches startConversationCoverage
 * came from a stale or racing tab, and "she went away herself in the meantime"
 * and "her account was switched off" are different facts about different
 * people that whoever posted it needs told apart.
 */
export function coverRefusal(
  away: CoverageAccount,
  cover: CoverageAccount | null | undefined,
): string | null {
  if (!cover) {
    return "That staff account no longer exists.";
  }

  if (cover.id === away.id) {
    return "Conversations cannot be covered by the advisor going away.";
  }

  if (!cover.active) {
    return "Conversations can only be covered by an active staff member.";
  }

  // Otherwise the hand-off lands on somebody who is not reading either, which
  // is the state coverage exists to end rather than to pass along.
  if (cover.coveredByUserId) {
    return "That staff member is away and covered by somebody else.";
  }

  return null;
}

/** Whether this staff member may be offered as a cover at all. */
export function canCover(away: CoverageAccount, cover: CoverageAccount) {
  return coverRefusal(away, cover) === null;
}

/**
 * Who may arrange coverage for an account.
 *
 * An admin arranges it for anyone - that is the case where somebody has already
 * left or been switched off and cannot act at all. An advisor arranges her own,
 * which is the case the feature was asked for: she is going on holiday on
 * Friday and hands her book over before she leaves.
 */
export function canManageCoverage(user: AppUser, targetUserId: string) {
  return user.role === Role.ADMIN || user.id === targetUserId;
}

/**
 * Whether this person may make the hand-off permanent.
 *
 * Only an admin. Handing your conversations over while you are away is
 * arranging cover; giving them away for good is a decision about who owns the
 * customer, and it is not reversible by the person who made it - there is no
 * record of where the threads came from afterwards, by design, because there is
 * nobody for them to go back to.
 */
export function canHandOffPermanently(user: AppUser) {
  return user.role === Role.ADMIN;
}

/** What happens to one covered thread when the advisor it belongs to returns. */
export type CoverageOutcome = "returns" | "stays";

/**
 * Whether a covered thread goes back to the advisor returning, or stays with
 * whoever has been holding it.
 *
 * It stays as soon as anyone else has answered the customer on it since
 * coverage began. The customer is then mid-exchange with the cover, and handing
 * the thread back would be a second change of voice on the same conversation -
 * the exact discontinuity coverage exists to prevent. Everything the cover
 * never answered goes back, so an advisor returning from a week away finds her
 * quiet threads where she left them.
 *
 * Three things decide it, and each is load-bearing:
 *
 * - `OUTBOUND` only. An internal note is not something the customer saw, so it
 *   creates no discontinuity for them; a cover who read a thread and left
 *   herself a note has not taken it over.
 * - Somebody other than the returning advisor. Her own replies from before she
 *   left are not evidence that anyone covered anything.
 * - Since coverage began, which is why `User.coveredSince` is written with
 *   `User.coveredByUserId` and never without it. Replies from an earlier trip,
 *   or from a colleague who happened to answer once last month, are not this
 *   coverage.
 *
 * A reply with no recorded sender is not counted. Nothing in the app writes
 * one, and if something ever does, "a machine sent a text" is not a person the
 * thread can be left with.
 *
 * Delivery is deliberately not read. A reply that failed to reach the carrier
 * counts, even though the customer never saw it: the cover is mid-fix on it,
 * with the failure banner in front of her that src/lib/message-delivery.ts
 * puts there, and handing that thread back drops the retry along with the
 * work. "The customer saw it" is why an internal note is excluded; it is not
 * the test for whether the cover has taken the thread on.
 *
 * Takes the messages rather than a database filter so this decision is made in
 * one place and can be tested as itself: the caller loads the window
 * (`createdAt >= coveredSince`) and this decides the rest.
 */
export function coverageOutcome(
  returningUserId: string,
  messagesSinceCoverageBegan: ReadonlyArray<{ direction: string; senderUserId: string | null }>,
): CoverageOutcome {
  const answeredByTheCover = messagesSinceCoverageBegan.some(
    (message) =>
      message.direction === MessageDirection.OUTBOUND &&
      message.senderUserId !== null &&
      message.senderUserId !== returningUserId,
  );

  return answeredByTheCover ? "stays" : "returns";
}
