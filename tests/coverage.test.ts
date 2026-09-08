import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  canCover,
  canHandOffPermanently,
  canManageCoverage,
  coverRefusal,
  coverageDisposition,
  coverageEndRefusal,
  coverageHolder,
  coverageLandsOn,
  coverageOutcome,
  describeCoveredThreads,
  openConversationStatuses,
  openConversationWhere,
  parseCoverageKind,
} from "../src/lib/coverage";
import { canAccessConversation } from "../src/lib/conversation-access";
import { sessionCannotBeProvenCurrent } from "../src/lib/session-cutoff";
import { assigneeAddressedTypes } from "../src/lib/notification-facts";
import {
  ConversationStatus,
  MessageDirection,
  NotificationType,
} from "../src/generated/prisma/enums";

// An advisor goes away and her open conversations stay assigned to her, so the
// customers in them are mid-conversation with somebody who is not reading.
// Coverage hands those threads to a colleague who is here, and hands back the
// quiet ones when she returns.
//
// Four surfaces have to agree about that and none of them can be asked at
// runtime: the picker of who may cover, the action that re-checks the name it
// gets back, the buttons each card offers, and the thread-by-thread decision
// when coverage ends. The last of those is the one this file exists for. It
// runs once per advisor per trip, on a page nobody is watching, so a regression
// in it would show up months later as a customer being handed back and forth.
//
// What this suite does NOT reach: endConversationCoverage's own writes. It is
// database-free, so the clause that decides which threads a return even loads
// (`where: { coveredForUserId: returningUserId }`) and the updateMany that
// clears the mark for the same id are not executed by anything here. Rules are
// pinned; the action applying them is not.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

const alyssa = { id: "alyssa", active: true, coveredByUserId: null };
const ben = { id: "ben", active: true, coveredByUserId: null };
const away = { id: "away", active: true, coveredByUserId: "ben" };
const switchedOff = { id: "switched-off", active: false, coveredByUserId: null };

const advisor = { id: "alyssa", role: "SERVICE", department: "SERVICE" };
const manager = { id: "marcus", role: "MANAGER", department: "GENERAL" };
const admin = { id: "dana", role: "ADMIN", department: "GENERAL" };

const reply = (senderUserId: string | null) => ({
  direction: MessageDirection.OUTBOUND,
  senderUserId,
});
const note = (senderUserId: string | null) => ({
  direction: MessageDirection.INTERNAL,
  senderUserId,
});
const inbound = { direction: MessageDirection.INBOUND, senderUserId: null };

// The gap itself, reproduced and then closed, because it is the thing the
// feature exists for: an advisor holds an open thread filed under a department
// nobody else works, she is deactivated, and the customer is left mid-
// conversation with nobody reading. Composed from the rules the app really runs
// - the deactivation cutoff, the thread guard every page and server action
// asks, and the coverage rules here - rather than from the server action, which
// needs a database this repo's tests do not have. So what these do not prove is
// that the action performs the move; what they do prove is that moving the
// assignment is what closes the gap, and that neither the return nor closed
// history quietly reopens it.

describe("the gap coverage closes", () => {
  type Thread = {
    status: string;
    department: string;
    assignedUserId: string | null;
    assignedUser: { active: boolean } | null;
    messages: ReadonlyArray<{ direction: string; senderUserId: string | null }>;
  };

  const hers = advisor;
  const cover = { id: "ben", role: "SERVICE", department: "SERVICE" };
  const alsoOnTheFloor = { id: "cara", role: "SERVICE", department: "SERVICE" };

  // Filed under a department neither colleague works, so the only thing that
  // can admit either of them is the assignment. This is the shape the PRD's
  // reproduction ran on: the thread under GENERAL that 404ed for the floor.
  const filedElsewhere = (
    assignedUserId: string | null,
    messages: Thread["messages"] = [],
    status: string = ConversationStatus.OPEN,
    holderReads = true,
  ): Thread => ({
    status,
    department: "GENERAL",
    assignedUserId,
    assignedUser: assignedUserId ? { active: holderReads } : null,
    messages,
  });

  const handOffToTheCover = (conversation: Thread): Thread =>
    (openConversationStatuses as readonly string[]).includes(conversation.status)
      ? { ...conversation, assignedUserId: cover.id }
      : conversation;

  const afterCoverageEnds = (conversation: Thread): Thread => ({
    ...conversation,
    assignedUserId: coverageHolder(
      coverageDisposition("return", hers.id, cover.id, conversation),
      hers.id,
      cover.id,
      conversation.assignedUserId,
    ),
  });

  it("hands a thread nobody could reach to somebody who is here", () => {
    const stranded = filedElsewhere(hers.id, [], ConversationStatus.OPEN, false);

    // Before: the guard admits her and nobody else, because no colleague works
    // the department it is filed under.
    assert.equal(canAccessConversation(hers, stranded), true);
    assert.equal(canAccessConversation(cover, stranded), false);
    assert.equal(canAccessConversation(alsoOnTheFloor, stranded), false);

    // And deactivation ends every session she holds, so the one account the
    // guard admits cannot reach the app at all. Nobody is reading the customer.
    const accessEnded = new Date("2026-09-07T15:00:00.000Z");

    assert.equal(sessionCannotBeProvenCurrent(accessEnded.getTime() - 1, accessEnded), true);

    // After: the same guard admits the cover, and it is the assignment that does
    // it - her department still does not.
    const covered = handOffToTheCover(stranded);

    assert.equal(canAccessConversation(cover, covered), true);
    assert.equal(canAccessConversation(alsoOnTheFloor, covered), false);
  });

  it("leaves a finished thread out of reach", () => {
    // Closed history stays attributed to whoever handled it, so the hand-off
    // does not reach it and the cover does not inherit it.
    const finished = filedElsewhere(hers.id, [], ConversationStatus.CLOSED, false);

    assert.equal(canAccessConversation(cover, handOffToTheCover(finished)), false);
  });

  it("hands back the quiet thread and leaves the cover the one she answered", () => {
    // The stays-with-the-cover rule, read as reachability: bouncing a live
    // thread back mid-exchange is the second discontinuity coverage exists to
    // prevent, and the customer would be talking to somebody who can no longer
    // open it.
    const quiet = afterCoverageEnds(filedElsewhere(cover.id));
    const answered = afterCoverageEnds(filedElsewhere(cover.id, [inbound, reply(cover.id)]));

    assert.equal(canAccessConversation(hers, quiet), true);
    assert.equal(canAccessConversation(cover, quiet), false);

    assert.equal(canAccessConversation(cover, answered), true);
    assert.equal(canAccessConversation(hers, answered), false);
  });
});

describe("coverageOutcome", () => {
  // The first argument is the COVER, not the advisor returning: the rule asks
  // whether the cover has taken this customer on. Each condition is pinned on
  // its own, because the rule is a set of deliberate exclusions and a change
  // that quietly drops one should fail here by name.
  it("hands back a thread the cover never answered", () => {
    assert.equal(coverageOutcome("ben", []), "returns");
    assert.equal(coverageOutcome("ben", [inbound]), "returns");
  });

  it("leaves a thread the cover has replied to with the cover", () => {
    // The customer is mid-exchange with the cover. Handing the thread back is a
    // second change of voice on the same conversation, which is the exact
    // discontinuity coverage exists to prevent.
    assert.equal(coverageOutcome("ben", [inbound, reply("ben")]), "stays");
  });

  it("does not count a reply from somebody who is not the cover", () => {
    // The case that produced the rule as it now stands. A manager opens a
    // covered thread - reachable to any admin, and to any colleague in its
    // department - and answers once; the cover never touches it. That is
    // spot-help, not taking the thread on, and keeping it away from the advisor
    // would park it with a cover who never spoke to this customer: a third
    // voice, which is the harm the rule exists to prevent. It goes back to her.
    //
    // Changed from "anyone other than the returning advisor" on 2026-09-08 -
    // see content/decisions/2026-09-07-a-thread-the-cover-answered-stays-with-the-cover.md.
    assert.equal(coverageOutcome("ben", [inbound, reply("marcus")]), "returns");

    // And a manager answering does not stop the cover's own reply counting.
    assert.equal(coverageOutcome("ben", [reply("marcus"), reply("ben")]), "stays");
  });

  it("does not count an internal note as having taken the thread over", () => {
    // The customer never saw it, so nothing about the conversation changed for
    // them. A cover who read a thread and left herself a reminder has not
    // stepped into it.
    assert.equal(coverageOutcome("ben", [note("ben")]), "returns");
  });

  it("does not count the returning advisor's own replies", () => {
    // She can reply on her own thread during coverage - reachable through her
    // department, or after being switched back on - and her own voice on her
    // own conversation is not somebody else covering it. She is excluded by the
    // same test as anyone else, because a cover is never the advisor she is
    // covering for.
    assert.equal(coverageOutcome("ben", [reply("alyssa")]), "returns");
    assert.equal(coverageOutcome("ben", [reply("alyssa"), reply("ben")]), "stays");
  });

  it("counts a reply from the cover that failed to send", () => {
    // The customer never saw it, but the cover is mid-fix on it with the
    // failure banner in front of her. Handing the thread back drops the retry.
    // Delivery is not part of the rule, so a FAILED reply reads the same here
    // as a delivered one - this pins that the rule never grew a fourth
    // condition that quietly reverses it.
    // Carrying the delivery status the real row carries, which the rule must go
    // on ignoring.
    const failed = { ...reply("ben"), deliveryStatus: "FAILED" };

    assert.equal(coverageOutcome("ben", [failed]), "stays");

    // A failed reply from somebody who is not the cover is still not the cover
    // taking it on - the mid-fix reasoning is about her banner, not anyone's.
    const failedByAManager = { ...reply("marcus"), deliveryStatus: "FAILED" };

    assert.equal(coverageOutcome("ben", [failedByAManager]), "returns");
  });

  it("does not count a reply with no recorded sender", () => {
    // Nothing writes one today. If something ever does, "a machine sent a text"
    // is not a person a customer's thread can be left with.
    assert.equal(coverageOutcome("ben", [reply(null)]), "returns");
  });
});

// The other half of the return: who is holding the thread on the day she walks
// back in. A covered thread can be with her, with the cover, with somebody a
// manager routed it to, or with nobody, and each of those beats the reply rule
// for its own reason. The combinations are the point - eight of them, plus the
// closed case - so they are enumerated here rather than left to be re-derived.

const thread = (
  assignedUserId: string | null,
  messages: ReadonlyArray<{ direction: string; senderUserId: string | null }> = [],
  status: string = ConversationStatus.OPEN,
  holderReads = true,
) => ({
  status,
  assignedUserId,
  assignedUser: assignedUserId ? { active: holderReads } : null,
  messages,
});

const heldByAnOffAccount = (
  assignedUserId: string,
  messages = [] as ReadonlyArray<{ direction: string; senderUserId: string | null }>,
) => thread(assignedUserId, messages, ConversationStatus.OPEN, false);

const coverReplied = [reply("ben")];

describe("coverageDisposition", () => {
  it("hands back what the cover never answered", () => {
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("ben")), "returned");
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("ben", [note("ben")])), "returned");
  });

  it("leaves the cover a thread she has answered", () => {
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("ben", coverReplied)), "staysPut");
  });

  it("has nothing to move when the thread is already hers", () => {
    // Somebody reassigned it back to her by hand mid-coverage, so the return
    // moves nothing whether or not the cover had answered it.
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("alyssa")), "alreadyHers");
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("alyssa", coverReplied)), "alreadyHers");
  });

  it("does not take a thread back off somebody a manager routed it to", () => {
    // A manager handing a covered thread to a parts specialist made a decision.
    // An advisor walking back in must not silently undo it - and she did undo
    // it, because the old rule only asked whether the holder was her.
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("parts")), "staysPut");
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("parts", coverReplied)), "staysPut");
  });

  it("gives her a thread nobody is holding, answered or not", () => {
    // "Stays with the cover" needs a cover holding it. With no assignee the
    // reply rule would have stranded an open customer thread owned by nobody -
    // the exact state coverage exists to end.
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread(null)), "returned");
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread(null, coverReplied)), "returned");
  });

  it("brings back a thread whose holder cannot read it", () => {
    // Staying put exists because the holder is mid-exchange with the customer.
    // A switched-off account is mid-nothing, and coverage is about to clear the
    // mark that could have brought the thread back, so leaving it there strands
    // it for good. True of the cover and of a third party alike: a routing
    // decision to an account nobody can sign in as is not a live decision.
    assert.equal(coverageDisposition("return", "alyssa", "ben", heldByAnOffAccount("ben", coverReplied)), "returned");
    assert.equal(coverageDisposition("return", "alyssa", "ben", heldByAnOffAccount("parts")), "returned");
    assert.equal(coverageDisposition("return", "alyssa", "ben", heldByAnOffAccount("parts", coverReplied)), "returned");
  });

  it("leaves a thread alone while its holder is still reading", () => {
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("ben", coverReplied)), "staysPut");
    assert.equal(coverageDisposition("return", "alyssa", "ben", thread("parts")), "staysPut");
  });

  it("never moves a thread closed during coverage", () => {
    // Closed history is not re-attributed, whoever happens to hold it.
    for (const holder of ["ben", "parts", null]) {
      assert.equal(
        coverageDisposition("return", "alyssa", "ben", thread(holder, [], ConversationStatus.CLOSED)),
        "staysPut",
        `closed thread held by ${holder ?? "nobody"}`,
      );
    }

    assert.equal(
      coverageDisposition("return", "alyssa", "ben", thread("alyssa", [], ConversationStatus.CLOSED)),
      "alreadyHers",
    );
  });

  it("moves a thread waiting on either side", () => {
    // Every open status the hand-off moves is a status the return moves back.
    for (const status of openConversationStatuses) {
      assert.equal(coverageDisposition("return", "alyssa", "ben", thread("ben", [], status)), "returned", status);
    }
  });
});

describe("coverageDisposition when the coverage is left with the cover", () => {
  it("gives the cover a thread nobody is holding", () => {
    // "Leave them with the cover" is what was pressed, so an unassigned thread
    // goes there rather than out of coverage owned by nobody - the mark that
    // would have brought it back is about to be cleared.
    assert.equal(coverageDisposition("keep", "alyssa", "ben", thread(null)), "toTheCover");
    assert.equal(
      coverageDisposition("keep", "alyssa", "ben", thread(null, coverReplied)),
      "toTheCover",
    );
  });

  it("moves nothing the cover or anyone else is already holding", () => {
    // The whole point of this ending is that it moves nothing.
    assert.equal(coverageDisposition("keep", "alyssa", "ben", thread("ben")), "staysPut");
    assert.equal(coverageDisposition("keep", "alyssa", "ben", thread("ben", coverReplied)), "staysPut");
    assert.equal(coverageDisposition("keep", "alyssa", "ben", thread("parts")), "staysPut");
    assert.equal(
      coverageDisposition("keep", "alyssa", "ben", thread(null, [], ConversationStatus.CLOSED)),
      "staysPut",
    );
  });

  it("still reports a thread already back with the departing advisor", () => {
    assert.equal(coverageDisposition("keep", "alyssa", "ben", thread("alyssa")), "alreadyHers");
  });
});

// Coverage chains, so a thread can be inside two of them at once: Ben answers
// it while covering for Alyssa, then Ben goes away himself and Cara takes it on.
// `Conversation.coveredForUserId` records one advisor, so such a thread
// remembers only the coverage that marked it first, and Ben's own claim on it
// is recorded nowhere. The limitation is written up in
// content/prds/2026-09-07-somebody-is-reading-while-she-is-away.md.
//
// Only half of that is reachable from here. The decision Alyssa's return makes
// is a rule and is asserted below. Which advisor's return can see the thread at
// all is not: that is endConversationCoverage's loading clause and its
// mark-clearing, both named in this file's header as outside the suite.

describe("a thread that passes through two coverages", () => {
  // Marked for Alyssa when Ben's coverage moved it, and never re-marked: a
  // coverage that starts does not overwrite the mark. Held by Cara since Ben
  // left, answered by Ben inside Alyssa's window.
  const answeredByBenHeldByCara = {
    status: ConversationStatus.OPEN,
    assignedUserId: "cara",
    assignedUser: { active: true },
    messages: [inbound, reply("ben")],
  };

  it("goes back to the advisor it belongs to when the cover holding it never answered", () => {
    // Cara is the cover whose coverage this return is ending, and she has never
    // spoken to this customer - Ben did, before he left. Under the rule as it
    // now stands only the cover's own reply keeps a thread, so this goes back to
    // Alyssa: the voice the customer had before any of this, rather than a
    // third one they have never heard from.
    //
    // This is the case that changed on 2026-09-08. The old rule counted a reply
    // from anyone but the returning advisor, so Ben's reply parked the thread
    // with Cara permanently - which is the exact harm the rule exists to
    // prevent, done by the rule itself.
    const disposition = coverageDisposition("return", "alyssa", "cara", answeredByBenHeldByCara);

    assert.equal(disposition, "returned");
    assert.equal(
      coverageHolder(disposition, "alyssa", "cara", answeredByBenHeldByCara.assignedUserId),
      "alyssa",
    );
  });

  it("leaves it with the second cover once she has answered the customer herself", () => {
    // The stays-with-the-cover rule still applies inside the second coverage:
    // Cara is now mid-exchange, so bouncing it to Alyssa would be the second
    // discontinuity.
    const answeredByCara = {
      ...answeredByBenHeldByCara,
      messages: [inbound, reply("ben"), reply("cara")],
    };
    const disposition = coverageDisposition("return", "alyssa", "cara", answeredByCara);

    assert.equal(disposition, "staysPut");
    assert.equal(coverageHolder(disposition, "alyssa", "cara", "cara"), "cara");
  });

  it("still hands back a thread the second cover never answered", () => {
    // The ordinary rule is untouched inside the second coverage, which is what
    // makes the case above a gap in what the mark records rather than a gap in
    // the return rule: a thread marked for Ben that Cara has not answered comes
    // back to him.
    const quiet = { ...answeredByBenHeldByCara, messages: [] };
    const disposition = coverageDisposition("return", "ben", "cara", quiet);

    assert.equal(disposition, "returned");
    assert.equal(coverageHolder(disposition, "ben", "cara", "cara"), "ben");
  });
});

describe("coverageHolder", () => {
  it("names where each disposition leaves the thread", () => {
    // The assignment the end writes, the recipient its alerts are re-addressed
    // to and the holder its audit row names are one fact, so they are read from
    // one place. Naming the account a thread came off instead is what once put
    // "nobody holds this" on a row for a thread the same transaction had just
    // given back.
    const heldByAThirdParty = "parts";

    assert.equal(coverageHolder("returned", "alyssa", "ben", heldByAThirdParty), "alyssa");
    assert.equal(coverageHolder("alreadyHers", "alyssa", "ben", "alyssa"), "alyssa");
    assert.equal(coverageHolder("toTheCover", "alyssa", "ben", null), "ben");
    assert.equal(coverageHolder("staysPut", "alyssa", "ben", heldByAThirdParty), heldByAThirdParty);
  });

  it("reports nobody only for a thread this ending left with nobody", () => {
    // Every disposition that moves a thread names an account, so a null here is
    // a thread nothing moved rather than a hole in the record.
    assert.equal(coverageHolder("staysPut", "alyssa", "ben", null), null);

    for (const disposition of ["returned", "alreadyHers", "toTheCover"] as const) {
      assert.ok(coverageHolder(disposition, "alyssa", "ben", null), disposition);
    }
  });
});

describe("coverageLandsOn", () => {
  const ben = { name: "Ben", active: true };
  const parts = { name: "Parts", active: true };
  const open = (heldBy: typeof ben | null) => ({ status: ConversationStatus.OPEN, heldBy });
  const closed = (heldBy: typeof ben | null) => ({ status: ConversationStatus.CLOSED, heldBy });

  it("lands each open thread on whoever holds it now", () => {
    // Not on the cover: coverage chains, and a thread can be routed on by hand,
    // so the account a thread is finalised onto is its own holder.
    assert.deepEqual(coverageLandsOn(ben, [open(parts)]), [parts]);
  });

  it("lands a thread nobody holds on the cover", () => {
    // The only case the cover is left with anything.
    assert.deepEqual(coverageLandsOn(ben, [open(null)]), [ben]);
  });

  it("names nobody when every covered thread is closed", () => {
    // Leaving history where it is finalises nothing onto anyone. Naming the
    // cover regardless refused an ending that would have put nothing with her,
    // which left a coverage whose two endings were both disabled and could not
    // be cleared at all.
    assert.deepEqual(coverageLandsOn(ben, [closed(ben), closed(null), closed(parts)]), []);
    assert.deepEqual(coverageLandsOn(ben, []), []);
  });
});

describe("describeCoveredThreads", () => {
  const alyssaAway = { id: "alyssa", name: "Alyssa" };
  const ben = { id: "ben", name: "Ben" };
  const parts = { id: "parts", name: "Parts" };
  const held = (heldBy: typeof ben | null) => ({ heldBy });

  // Her own card and an admin's view of it, which differ only in whether she is
  // "you" or her name.
  const onHerCard = true;
  const onTheFloor = false;

  it("counts what the cover is actually holding", () => {
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(ben), held(ben), held(ben)], onHerCard),
      "Ben is holding 3 of your open conversations.",
    );
  });

  it("keeps the set it is counting from plural and agrees only the verb", () => {
    // One thread left is the routine end of a coverage - the cover closes them
    // one at a time - so this is the reading an advisor sees most often, and
    // "1 of Alyssa's open conversation" was the wrong half to pluralise.
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(ben)], onTheFloor),
      "Ben is holding 1 of Alyssa's open conversations.",
    );
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(null)], onHerCard),
      "1 of your open conversations is covered: 1 is with nobody.",
    );
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(parts)], onHerCard),
      "1 of your open conversations is covered: Parts has 1.",
    );
  });

  it("does not claim the cover holds a thread somebody routed on by hand", () => {
    // The line used to count the coverage mark, which a hand-reassignment
    // deliberately leaves in place, so it told an admin the cover had five
    // while a parts specialist had two of them - on the screen whose whole job
    // is answering who is reading these customers.
    assert.equal(
      describeCoveredThreads(
        alyssaAway,
        ben,
        [held(ben), held(ben), held(ben), held(parts), held(parts)],
        onTheFloor,
      ),
      "5 of Alyssa's open conversations are covered: Ben has 3 and Parts has 2.",
    );
  });

  it("says plainly when nobody is holding one", () => {
    // The state coverage exists to end, so it is named rather than folded into
    // the cover's count - which is what reading landsOn here would do.
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(ben), held(null)], onHerCard),
      "2 of your open conversations are covered: Ben has 1 and 1 is with nobody.",
    );
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(null), held(null)], onHerCard),
      "2 of your open conversations are covered: 2 are with nobody.",
    );
  });

  it("names the cover first and everyone else after", () => {
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(parts), held(null), held(ben)], onHerCard),
      "3 of your open conversations are covered: Ben has 1, Parts has 1 and 1 is with nobody.",
    );
  });

  it("says a thread routed back to her is already hers rather than naming her as a holder", () => {
    // A manager can route a covered thread back to her by hand, which leaves
    // the mark in place, so she can be holding one of her own covered threads
    // before she has pressed anything. "Alyssa has 1" on Alyssa's own card
    // described it as out with a cover while naming her as its holder.
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(ben), held(alyssaAway)], onHerCard),
      "2 of your open conversations are covered: Ben has 1 and 1 is already back with you.",
    );
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(ben), held(alyssaAway)], onTheFloor),
      "2 of Alyssa's open conversations are covered: Ben has 1 and 1 is already back with Alyssa.",
    );
  });

  it("does not call a coverage that is entirely back with her covered", () => {
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(alyssaAway)], onHerCard),
      "1 of your open conversations is already back with you.",
    );
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [held(alyssaAway), held(alyssaAway)], onTheFloor),
      "2 of Alyssa's open conversations are already back with Alyssa.",
    );
  });

  it("speaks only for the threads that were handed over", () => {
    // Reachable once the cover has closed everything and the coverage record is
    // still standing. It must not read as "your book is clear": a thread
    // triaged onto her after coverage began carries no mark, so it is not in
    // this set and is still open on somebody nobody has told her about.
    assert.equal(
      describeCoveredThreads(alyssaAway, ben, [], onHerCard),
      "Nothing handed to Ben is still open.",
    );
  });
});

describe("coverageEndRefusal", () => {
  const ben = { active: true, name: "Ben" };
  const benIsOff = { active: false, name: "Ben" };
  const partsIsOff = { active: false, name: "Parts" };

  it("lets coverage end either way while every account is on", () => {
    assert.equal(coverageEndRefusal("return", { active: true }, [ben]), null);
    assert.equal(coverageEndRefusal("keep", { active: true }, [ben]), null);
  });

  it("refuses to hand conversations back to a switched-off account", () => {
    // That puts them exactly where they started: assigned to somebody who is
    // not reading.
    assert.ok(coverageEndRefusal("return", { active: false }, [ben]));
  });

  it("refuses to finalise conversations onto a switched-off cover", () => {
    // Worse than the hand-back it mirrors: it also clears the mark that would
    // have brought them back, so nothing is left to undo it with.
    assert.match(coverageEndRefusal("keep", { active: true }, [benIsOff]) ?? "", /Ben/);
  });

  it("refuses on any account a thread would be left with, not just the cover", () => {
    // A thread routed on by hand mid-coverage is finalised onto whoever holds it
    // now. Judging the ending by the named cover alone let a switched-off third
    // party keep one for good.
    assert.match(coverageEndRefusal("keep", { active: true }, [ben, partsIsOff]) ?? "", /Parts/);
  });

  it("allows an ending that would leave nothing with the switched-off account", () => {
    // The cover used to be named unconditionally, so once she and the advisor
    // had both left and every covered thread was closed, neither ending was
    // pressable and the coverage record could not be cleared at all. An account
    // belongs in the set only when a thread would really be left with it.
    assert.equal(coverageEndRefusal("keep", { active: true }, []), null);
    assert.equal(coverageEndRefusal("keep", { active: false }, []), null);
  });

  it("stops offering the hand-over as the alternative when it is refused too", () => {
    // The hand-back refusal used to end "or leave them with the cover", which
    // contradicts the sentence printed beside it when that ending is blocked.
    assert.match(coverageEndRefusal("return", { active: false }, [ben]) ?? "", /leave them with the cover/);
    assert.doesNotMatch(
      coverageEndRefusal("return", { active: false }, [benIsOff]) ?? "",
      /leave them with the cover/,
    );
  });

  it("reads the returning advisor for the hand-back and the holders for the hand-over", () => {
    assert.equal(coverageEndRefusal("keep", { active: false }, [ben]), null);
    assert.equal(coverageEndRefusal("return", { active: true }, [benIsOff]), null);
  });
});

describe("coverRefusal", () => {
  it("accepts an active colleague who is not away themselves", () => {
    assert.equal(coverRefusal(alyssa, ben), null);
    assert.equal(canCover(alyssa, ben), true);
  });

  it("refuses the advisor going away", () => {
    assert.ok(coverRefusal(alyssa, alyssa));
    assert.equal(canCover(alyssa, alyssa), false);
  });

  it("refuses a switched-off account", () => {
    // Handing threads to an account that cannot sign in leaves them exactly
    // where they started: assigned to somebody who is not reading.
    assert.ok(coverRefusal(alyssa, switchedOff));
    assert.equal(canCover(alyssa, switchedOff), false);
  });

  it("refuses somebody who is away and covered themselves", () => {
    assert.ok(coverRefusal(alyssa, away));
    assert.equal(canCover(alyssa, away), false);
  });

  it("refuses an account that no longer exists", () => {
    assert.ok(coverRefusal(alyssa, null));
  });

  it("gives a different reason for each refusal", () => {
    // The server action refuses a stale post with these. "She is away herself"
    // and "her account is switched off" are facts about different people and
    // must not collapse into one sentence.
    const reasons = [
      coverRefusal(alyssa, alyssa),
      coverRefusal(alyssa, switchedOff),
      coverRefusal(alyssa, away),
      coverRefusal(alyssa, null),
    ];

    assert.equal(new Set(reasons).size, reasons.length);
  });
});

describe("who may arrange coverage", () => {
  it("lets an advisor arrange her own", () => {
    // The case the feature was asked for: she is going on holiday on Friday and
    // hands her book over before she leaves.
    assert.equal(canManageCoverage(advisor, advisor.id), true);
  });

  it("lets an admin arrange anyone's", () => {
    // Including somebody already switched off, who cannot act at all.
    assert.equal(canManageCoverage(admin, advisor.id), true);
  });

  it("does not let one advisor arrange another's", () => {
    assert.equal(canManageCoverage(advisor, "ben"), false);
  });

  it("does not let a manager arrange somebody else's", () => {
    // A manager reads the floor; staff account changes are the admin's, and
    // this moves customer conversations between people.
    assert.equal(canManageCoverage(manager, advisor.id), false);
    assert.equal(canManageCoverage(manager, manager.id), true);
  });

  it("keeps a permanent hand-off to admins", () => {
    // Arranging cover is reversible; giving conversations away for good is a
    // decision about who owns the customer, and nothing records where they came
    // from afterwards.
    assert.equal(canHandOffPermanently(admin), true);
    assert.equal(canHandOffPermanently(advisor), false);
    assert.equal(canHandOffPermanently(manager), false);
  });

  it("only accepts the two shapes coverage has", () => {
    assert.equal(parseCoverageKind("temporary"), "temporary");
    assert.equal(parseCoverageKind("permanent"), "permanent");
    assert.equal(parseCoverageKind(""), null);
    assert.equal(parseCoverageKind("forever"), null);
  });
});

describe("what coverage moves", () => {
  it("moves every conversation that is not finished", () => {
    const moved = new Set<string>(openConversationStatuses);
    const every = Object.values(ConversationStatus);

    assert.deepEqual(
      every.filter((status) => !moved.has(status)),
      [ConversationStatus.CLOSED],
    );
  });

  it("leaves closed history where it is", () => {
    // A thread somebody finished stays attributed to whoever finished it,
    // whatever happens to their account afterwards.
    const moves: readonly string[] = openConversationWhere.status.in;

    assert.equal(moves.includes(ConversationStatus.CLOSED), false);
  });
});

// The one rule below that is deliberately asserted over source rather than over
// behaviour. Who may do what is already pinned by the canManageCoverage and
// canHandOffPermanently tests above; what those cannot see is whether an action
// asks. That is a structural fact about a call site, so it is read as one.

describe("both server actions ask the rules", () => {
  const actions = join("src", "app", "actions.ts");

  // One server action's own body, so a rule asserted here cannot be satisfied
  // by a different action further down the file. Same slicing as
  // tests/session-revocation.test.ts.
  function serverAction(name: string) {
    const [, body] = read(actions).split(`export async function ${name}(`);

    assert.ok(body, `expected a ${name} server action`);

    return body.split("\nexport ")[0];
  }

  it("re-checks in each action every rule the board rendered", () => {
    // A form posted from a stale tab is not a form this app rendered, and both
    // spellings of the permanent hand-off are the admin's alone: `permanent` on
    // the way in, `keep` on the way out.
    //
    // Asserted against each action's own body rather than the whole file,
    // because a whole-file grep for canHandOffPermanently passed before the way
    // out was gated at all - the way in already mentioned it. Deleting the end
    // gate would have left this green while an advisor could arrange her own
    // coverage and then re-post the form with outcome flipped to keep.
    const start = serverAction("startConversationCoverage");
    const end = serverAction("endConversationCoverage");

    for (const body of [start, end]) {
      assert.match(body, /!canManageCoverage\(user, /);
      assert.match(body, /!canHandOffPermanently\(user\)/);
    }

    // Only the hand-off picks a cover, so only it re-checks who may be one.
    assert.match(start, /coverRefusal\(/);
  });
});

describe("the alerts that follow a thread", () => {
  it("leaves a follow-up's alerts alone", () => {
    // Those are addressed to the *task's* assignee. Coverage moves
    // conversations, not follow-ups, and src/lib/task-access.ts already lets
    // the department work one either way.
    assert.deepEqual([...assigneeAddressedTypes].sort(), [
      NotificationType.CONVERSATION_ASSIGNED,
      NotificationType.CONVERSATION_REASSIGNED,
      NotificationType.NEW_INBOUND_MESSAGE,
    ]);
  });
});

describe("the page guards itself", () => {
  it("calls requireUser rather than leaning on the (app) layout", () => {
    // Next does not re-render a shared layout when navigating between routes
    // inside it, so a staff member already standing in the app whose access has
    // ended reaches a layout-only-guarded page with nothing re-checking. Every
    // page under the segment guards itself; the layout is a convenience.
    //
    // Read over source deliberately, and CLAUDE.md owns the contract: the thing
    // being asserted is that a call exists in every page of a segment, which no
    // amount of exercising one page can show.
    const segment = join(repoRoot, "src", "app", "(app)");

    const pages = readdirSync(segment, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name === "page.tsx")
      .map((entry) => join(entry.parentPath, entry.name));

    assert.ok(pages.length > 1, "expected pages under the (app) segment");

    for (const page of pages) {
      assert.match(readFileSync(page, "utf8"), /await requireUser\(\)/, page);
    }
  });
});
