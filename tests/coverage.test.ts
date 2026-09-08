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
  coverageOutcome,
  openConversationStatuses,
  openConversationWhere,
  parseCoverageKind,
} from "../src/lib/coverage";
import { ConversationStatus, MessageDirection } from "../src/generated/prisma/enums";

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

describe("coverageOutcome", () => {
  it("hands back a thread the cover never answered", () => {
    assert.equal(coverageOutcome("alyssa", []), "returns");
    assert.equal(coverageOutcome("alyssa", [inbound]), "returns");
  });

  it("leaves a thread the cover has replied to with the cover", () => {
    // The customer is mid-exchange with the cover. Handing the thread back is a
    // second change of voice on the same conversation, which is the exact
    // discontinuity coverage exists to prevent.
    assert.equal(coverageOutcome("alyssa", [inbound, reply("ben")]), "stays");
  });

  it("does not count an internal note as having taken the thread over", () => {
    // The customer never saw it, so nothing about the conversation changed for
    // them. A cover who read a thread and left herself a reminder has not
    // stepped into it.
    assert.equal(coverageOutcome("alyssa", [note("ben")]), "returns");
  });

  it("does not count the returning advisor's own replies", () => {
    // She can reply on her own thread during coverage - reachable through her
    // department, or after being switched back on - and her own voice on her
    // own conversation is not somebody else covering it.
    assert.equal(coverageOutcome("alyssa", [reply("alyssa")]), "returns");
    assert.equal(coverageOutcome("alyssa", [reply("alyssa"), reply("ben")]), "stays");
  });

  it("counts a reply that failed to send", () => {
    // The customer never saw it, but the cover is mid-fix on it with the
    // failure banner in front of her. Handing the thread back drops the retry.
    // Delivery is not part of the rule, so a FAILED reply reads the same here
    // as a delivered one - this pins that the rule never grew a fourth
    // condition that quietly reverses it.
    // Carrying the delivery status the real row carries, which the rule must go
    // on ignoring.
    const failed = { ...reply("ben"), deliveryStatus: "FAILED" };

    assert.equal(coverageOutcome("alyssa", [failed]), "stays");
  });

  it("does not count a reply with no recorded sender", () => {
    // Nothing writes one today. If something ever does, "a machine sent a text"
    // is not a person a customer's thread can be left with.
    assert.equal(coverageOutcome("alyssa", [reply(null)]), "returns");
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

describe("one copy of each rule", () => {
  const actions = join("src", "app", "actions.ts");

  // One server action's own body, so a rule asserted here cannot be satisfied
  // by a different action further down the file. Same slicing as
  // tests/session-revocation.test.ts.
  function serverAction(name: string) {
    const [, body] = read(actions).split(`export async function ${name}(`);

    assert.ok(body, `expected a ${name} server action`);

    return body.split("\nexport ")[0];
  }

  it("decides the return thread by thread through coverageOutcome", () => {
    // The action loads the coverage window and nothing more; which of those
    // messages counts as the cover having answered is decided in one tested
    // place. A direction-and-sender comparison written out in the action is the
    // drift this guards.
    const source = read(actions);

    assert.match(source, /coverageOutcome\(returningUserId, conversation\.messages\)/);
    assert.match(source, /createdAt: \{ gte: returning\.coveredSince \}/);
  });

  it("counts and moves open conversations by the same clause", () => {
    // The number the board shows before the click and the rows the hand-off
    // actually moves have to be the same set.
    assert.match(read(actions), /\.\.\.openConversationWhere/);
    assert.match(read(join("src", "lib", "data.ts")), /where: openConversationWhere/);
  });

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

  it("keeps the rules out of the surfaces that render them", () => {
    // The page reads the rules; it must not restate them. A card that decides
    // for itself who may be offered as a cover is a card the action will refuse.
    const page = read(join("src", "app", "(app)", "coverage", "page.tsx"));

    assert.match(page, /from "@\/lib\/coverage"/);
    assert.doesNotMatch(page, /role === "ADMIN"|active === false|!candidate\.active/);
  });
});

describe("the alerts that follow a thread", () => {
  it("moves them with the assignment rather than leaving them addressed to somebody who left", () => {
    // A Notification row is stored once per recipient, so an alert still
    // addressed to the advisor who went away is an alert in nobody's rail: the
    // cover has the thread in her queue and nothing telling her it is waiting.
    assert.match(read(join("src", "app", "actions.ts")), /readdressAssigneeNotificationsTx\(/);
  });

  it("leaves a follow-up's alerts alone", () => {
    // Those are addressed to the *task's* assignee. Coverage moves
    // conversations, not follow-ups, and src/lib/task-access.ts already lets
    // the department work one either way.
    const facts = read(join("src", "lib", "notification-facts.ts"));
    const [, addressed] = facts.split("export const assigneeAddressedTypes");

    assert.ok(addressed);

    const list = addressed.split("];")[0];

    assert.doesNotMatch(list, /FOLLOW_UP/);
    assert.doesNotMatch(list, /SLA_MISSED|UNASSIGNED_CONVERSATION|MESSAGE_FAILED/);
  });
});

describe("the page guards itself", () => {
  it("calls requireUser rather than leaning on the (app) layout", () => {
    // Next does not re-render a shared layout when navigating between routes
    // inside it, so a staff member already standing in the app whose access has
    // ended reaches a layout-only-guarded page with nothing re-checking. Every
    // page under the segment guards itself; the layout is a convenience.
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
