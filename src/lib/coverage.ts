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

/** The same clause asked of one row already loaded. */
export function isOpenConversation(status: string): boolean {
  return (openConversationStatuses as readonly string[]).includes(status);
}

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
 * It stays once the cover has answered the customer on it since coverage began.
 * The customer is then mid-exchange with the cover, and handing the thread back
 * would be a second change of voice on the same conversation - the exact
 * discontinuity coverage exists to prevent. Everything the cover never answered
 * goes back, so an advisor returning from a week away finds her quiet threads
 * where she left them.
 *
 * Three things decide it, and each is load-bearing:
 *
 * - `OUTBOUND` only. An internal note is not something the customer saw, so it
 *   creates no discontinuity for them; a cover who read a thread and left
 *   herself a note has not taken it over.
 * - The cover, and nobody else. A manager or another advisor who answers once
 *   on a covered thread has spot-helped, not taken it on, and parking the
 *   thread with a cover who never spoke to that customer would hand them a
 *   third voice - the harm this rule exists to prevent. The returning advisor's
 *   own replies are excluded by the same test, since a cover is never the
 *   advisor she is covering for (`coverRefusal`).
 * - Since coverage began, which is why `User.coveredSince` is written with
 *   `User.coveredByUserId` and never without it. Replies from an earlier trip,
 *   or from a colleague who happened to answer once last month, are not this
 *   coverage.
 *
 * A reply with no recorded sender cannot match a cover's id, so "a machine sent
 * a text" is not a person the thread can be left with.
 *
 * Delivery is deliberately not read. A reply from the cover that failed to
 * reach the carrier counts, even though the customer never saw it: she is
 * mid-fix on it, with the failure banner in front of her that
 * src/lib/message-delivery.ts puts there, and handing that thread back drops
 * the retry along with the work. "The customer saw it" is why an internal note
 * is excluded; it is not the test for whether the cover has taken the thread
 * on.
 *
 * Takes the messages rather than a database filter so this decision is made in
 * one place and can be tested as itself: the caller loads the window
 * (`createdAt >= coveredSince`) and this decides the rest.
 */
export function coverageOutcome(
  coverUserId: string,
  messagesSinceCoverageBegan: ReadonlyArray<{ direction: string; senderUserId: string | null }>,
): CoverageOutcome {
  const answeredByTheCover = messagesSinceCoverageBegan.some(
    (message) =>
      message.direction === MessageDirection.OUTBOUND && message.senderUserId === coverUserId,
  );

  return answeredByTheCover ? "stays" : "returns";
}

/** The two ways coverage can be ended, and therefore what the end does. */
export type CoverageEnd = "return" | "keep";

/**
 * The accounts a coverage would leave holding something, which is what
 * coverageEndRefusal has to judge an ending by.
 *
 * One open thread lands on whoever holds it now, and one nobody holds lands on
 * the cover, because that is the only case the cover is left with anything -
 * every other thread is finalised onto its current holder. Closed threads land
 * on nobody: leaving history where it is finalises nothing onto anyone.
 *
 * Here rather than at each caller because the board and the action both build
 * it, from different queries, and they have to agree - naming the cover
 * regardless once refused an ending that would have put nothing with her, which
 * left a coverage whose only two endings were both disabled.
 */
export function coverageLandsOn<Account>(
  cover: Account,
  covered: ReadonlyArray<{ status: string; heldBy: Account | null }>,
): Account[] {
  return covered.flatMap((thread) =>
    isOpenConversation(thread.status)
      ? [thread.heldBy ?? cover]
      : [],
  );
}

/**
 * The advisor a thread goes back to once this hand-off has moved it.
 *
 * A thread already carrying a mark keeps it, whichever button was pressed: it
 * is covering for an advisor further back, and handing a cover's book over -
 * even for good - does not give that advisor's customer away. So the advisor a
 * thread returns to is not always the advisor the hand-off is about. Only a
 * thread left carrying no mark has genuinely been handed over, and that is the
 * one case this names nobody for.
 *
 * Here rather than inline at the action because three records read it and have
 * to agree: the conversation's audit row, the in-thread note, and the note's
 * choice of wording.
 */
export function coverageReturnsTo(
  kind: CoverageKind,
  away: { id: string; name: string },
  conversation: { coveredForUserId: string | null },
  marked: ReadonlyArray<{ id: string; name: string }>,
): { id: string; name: string } | null {
  const goesBackTo = conversation.coveredForUserId ?? (kind === "temporary" ? away.id : null);

  if (goesBackTo === null) {
    return null;
  }

  return [away, ...marked].find((advisor) => advisor.id === goesBackTo) ?? null;
}

/**
 * The note a hand-off leaves in the thread itself - the trail an advisor reads
 * months later to work out who has been talking to her customer, and why.
 *
 * It names the advisor the thread genuinely returns to rather than the advisor
 * whose book was handed over, because on a chained thread those are different
 * people. Naming the wrong one puts a false sentence in a permanent record, and
 * a note naming the wrong person is worse than no note.
 *
 * Nobody to return to is the only genuine give-away, and is the only case that
 * reads as one.
 */
export function coverageHandOffNote(handOff: {
  byName: string;
  awayName: string;
  coverName: string;
  returnsToName: string | null;
}): string {
  return handOff.returnsToName
    ? `System: ${handOff.byName} handed this conversation to ${handOff.coverName} while ${handOff.returnsToName} is away.`
    : `System: ${handOff.byName} handed this conversation from ${handOff.awayName} to ${handOff.coverName} for good.`;
}

/**
 * Who is actually reading an advisor's covered conversations right now.
 *
 * Counted by the account each thread is assigned to, never by the coverage
 * mark. A covered thread keeps its mark when a manager routes it on by hand -
 * that is deliberate, because the return still has to decide its fate - so
 * counting marks and naming the cover told an admin "Ben is holding 5" while
 * Ben held 3 and a parts specialist had the other two. Coverage chains for the
 * same reason.
 *
 * Deliberately not `coverageLandsOn`, which is the other tense: that answers
 * where a thread would end up if the coverage were left with the cover, and so
 * reports one nobody holds as the cover's. Today nobody is reading that thread,
 * and this is the line that says so.
 *
 * The away advisor gets her own phrase, because she can be holding one of these
 * herself: a manager can route a covered thread back to her by hand, which
 * leaves the mark in place, and "Alyssa has 1" on Alyssa's card described a
 * thread as out with a cover while naming her as its holder.
 *
 * Returned as the sentence, the way describeOtherDepartments is, because the
 * card is its only reader and the wording is the part that has to stay true.
 * `mine` is her own card, where she is "you" rather than her name.
 */
export function describeCoveredThreads(
  away: { id: string; name: string },
  cover: { id: string; name: string },
  covered: ReadonlyArray<{ heldBy: { id: string; name: string } | null }>,
  mine: boolean,
): string {
  const whose = mine ? "your" : `${away.name}'s`;
  const her = mine ? "you" : away.name;
  const tally: Array<{ id: string | null; name: string | null; count: number }> = [];

  for (const thread of covered) {
    const id = thread.heldBy?.id ?? null;
    const seen = tally.find((entry) => entry.id === id);

    if (seen) {
      seen.count += 1;
    } else {
      tally.push({ id, name: thread.heldBy?.name ?? null, count: 1 });
    }
  }

  if (tally.length === 0) {
    return `Nothing handed to ${cover.name} is still open.`;
  }

  const total = covered.length;

  if (tally.length === 1 && tally[0].id === cover.id) {
    return `${cover.name} is holding ${total} of ${whose} open conversations.`;
  }

  if (tally.length === 1 && tally[0].id === away.id) {
    return `${total} of ${whose} open conversations ${
      total === 1 ? "is" : "are"
    } already back with ${her}.`;
  }

  const ordered = [
    ...tally.filter((entry) => entry.id === cover.id),
    ...tally.filter((entry) => entry.id !== cover.id),
  ];

  const phrases = ordered.map((entry) =>
    entry.id === away.id
      ? `${entry.count} ${entry.count === 1 ? "is" : "are"} already back with ${her}`
      : entry.name === null
        ? `${entry.count} ${entry.count === 1 ? "is" : "are"} with nobody`
        : `${entry.name} has ${entry.count}`,
  );

  const named =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;

  return `${total} of ${whose} open conversations ${
    total === 1 ? "is" : "are"
  } covered: ${named}.`;
}

/**
 * Open conversations sitting on this account that its coverage does not speak
 * for - the ones a colleague assigned to somebody the board already shows as
 * away.
 *
 * `describeCoveredThreads` answers only for threads carrying a coverage mark,
 * so on its own it reports an away advisor as fully covered while a customer
 * waits on a thread nobody moved. This is the difference: everything open on
 * her account, less the marked ones a manager routed back to her, which that
 * sentence already names as hers.
 *
 * Here rather than at either caller because the board and the Settings row
 * answer the same question for the same reader, and a count one of them can
 * state and the other cannot is how the two came to disagree in the first
 * place.
 */
export function threadsOffCoverage(
  awayId: string,
  openConversations: number,
  covered: ReadonlyArray<{ heldBy: { id: string } | null }>,
): number {
  const alreadyBack = covered.filter((thread) => thread.heldBy?.id === awayId).length;

  return Math.max(openConversations - alreadyBack, 0);
}

/**
 * That count as the sentence both surfaces print, or null when there is nothing
 * to say. A switched-off account is the amber case: those threads are open, on
 * an account nobody can sign in as, and outside the coverage that would have
 * moved them.
 */
export function describeThreadsOffCoverage(
  offCoverage: number,
  active: boolean,
  mine: boolean,
): string | null {
  if (offCoverage <= 0) {
    return null;
  }

  const whose = mine ? "your account" : "this account";
  const noun = offCoverage === 1 ? "conversation is" : "conversations are";
  const sentence = `${offCoverage} more open ${noun} still on ${whose}, outside this coverage`;

  return active
    ? `${sentence}.`
    : `${sentence}, and nobody is reading ${offCoverage === 1 ? "it" : "them"}.`;
}

/**
 * Why coverage cannot be ended this way yet, or null when it can.
 *
 * Both halves say the same thing from opposite ends: after coverage ends, no
 * open thread may be left with somebody who is not reading. Handing threads
 * back to a switched-off account puts them exactly where they started, and
 * finalising them onto one is worse - it also destroys the mark that would have
 * brought them back. Starting coverage already refuses an inactive cover; this
 * is the same rule at the other end.
 *
 * `landsOn` is every account that would actually be left holding one of these
 * threads if the coverage were left with the cover - each open thread's current
 * holder, or the cover for one nobody holds. Coverage can chain and a thread can
 * be routed on by hand, so the cover is not always the account a thread would be
 * finalised onto, and judging the ending by the named cover alone let a
 * switched-off third party keep one. Naming the cover regardless was wrong the
 * other way: it refused an ending that would have put nothing with her. The
 * hand-back reads the same set, but only to know whether the other ending is
 * still worth suggesting.
 *
 * A sentence rather than a boolean because both the board and the action need
 * it: the board disables the button and prints the reason, and the action
 * refuses a form posted from a stale tab with the same words.
 */
export function coverageEndRefusal(
  end: CoverageEnd,
  returning: { active: boolean },
  landsOn: ReadonlyArray<{ name: string; active: boolean }>,
): string | null {
  const notReading = landsOn.find((account) => !account.active);

  if (end === "return") {
    if (returning.active) {
      return null;
    }

    return notReading
      ? "Reactivate this account before handing its conversations back."
      : "Reactivate the account before handing its conversations back, or leave them with the cover.";
  }

  return notReading
    ? `${notReading.name}'s account is switched off, so leaving these conversations there would put them straight back with nobody reading. Reactivate that account, or arrange cover for it.`
    : null;
}

/** Where one covered thread ends up when coverage ends. */
export type CoverageDisposition = "returned" | "alreadyHers" | "toTheCover" | "staysPut";

/**
 * What becomes of one covered thread when the advisor it belongs to comes back.
 *
 * `coverageOutcome` answers only "has the cover been answering this customer".
 * That is the interesting half, but it is not the whole decision: a covered
 * thread can be closed, can have been routed on to a third person by hand, or
 * can have been left with nobody at all, and each of those beats the reply rule
 * for a different reason. Written as one function over all four so the set is
 * closed and testable, rather than as predicates spread through the action -
 * the combinations are what nobody can hold in their head.
 *
 * In order, and each one is load-bearing:
 *
 * - **She already holds it.** Somebody reassigned it back to her by hand during
 *   coverage. There is nothing for the return to move, whatever else is true.
 * - **It is finished.** Closed history is not re-attributed - the same rule that
 *   kept closed threads out of the hand-off in the first place.
 * - **Nobody holds it.** It goes to somebody, always, because a thread
 *   belonging to nobody is the exact state coverage exists to end - to her on
 *   the hand-back even when the cover has replied, since "stays with the cover"
 *   needs a cover holding it, and to the cover on "leave them with the cover",
 *   which is what the admin pressed. A null assignee is reachable both from the
 *   assignee picker's explicit unassigned option and from deleting a staff
 *   account, whose threads the foreign key nulls.
 * - **Whoever holds it cannot read it.** On the hand-back it goes to her
 *   instead. Staying put exists because the holder is mid-exchange with the
 *   customer; a switched-off account is mid-nothing, so the reason to leave it
 *   there is gone and honouring it would strand the thread for good - the mark
 *   that could have brought it back is cleared as coverage ends. This
 *   deliberately overrides the rule below: a routing decision to an account
 *   nobody can sign in as is not a live decision, and it is not worth orphaning
 *   a customer's thread to honour. The advisor returning is necessarily active,
 *   because coverageEndRefusal refuses the hand-back otherwise.
 * - **Somebody else holds it.** A manager routing a covered thread to a parts
 *   specialist made a decision, and an advisor walking back in must not silently
 *   undo it. It stays with them whether or not anyone has replied.
 * - Otherwise the cover holds it: she keeps it on "leave them with the cover",
 *   and on the hand-back the reply rule decides.
 */
export function coverageDisposition(
  end: CoverageEnd,
  returningUserId: string,
  coverUserId: string,
  conversation: {
    status: string;
    assignedUserId: string | null;
    /** The account holding it now, so this can ask whether that account reads. */
    assignedUser: { active: boolean } | null;
    /** The coverage window only - see coverageOutcome. */
    messages: ReadonlyArray<{ direction: string; senderUserId: string | null }>;
  },
): CoverageDisposition {
  if (conversation.assignedUserId === returningUserId) {
    return "alreadyHers";
  }

  if (!isOpenConversation(conversation.status)) {
    return "staysPut";
  }

  if (conversation.assignedUserId === null) {
    return end === "return" ? "returned" : "toTheCover";
  }

  if (conversation.assignedUser && !conversation.assignedUser.active) {
    return end === "return" ? "returned" : "staysPut";
  }

  if (conversation.assignedUserId !== coverUserId) {
    return "staysPut";
  }

  if (end === "keep") {
    return "staysPut";
  }

  return coverageOutcome(coverUserId, conversation.messages) === "returns"
    ? "returned"
    : "staysPut";
}

/**
 * Who is holding one covered thread once coverage has ended.
 *
 * `coverageDisposition` says what became of the thread; this says where that
 * leaves it, which is the fact everything afterwards depends on - the queue it
 * appears in, the guard that decides who may open it, the rail the alert about
 * it is addressed to, and the audit row that has to answer "who had this" a
 * year later. The action moves the threads in groups, so without this it would
 * be the only place that knows what those groups meant.
 */
export function coverageHolder(
  disposition: CoverageDisposition,
  returningUserId: string,
  coverUserId: string,
  heldNow: string | null,
): string | null {
  switch (disposition) {
    case "returned":
    case "alreadyHers":
      return returningUserId;
    case "toTheCover":
      return coverUserId;
    case "staysPut":
      return heldNow;
  }
}
