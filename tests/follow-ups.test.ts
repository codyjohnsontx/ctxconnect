import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultFollowUpDueDate,
  findMatchingFollowUp,
  normalizeFollowUpTitle,
} from "../src/lib/follow-ups";

describe("normalizeFollowUpTitle", () => {
  it("ignores case, punctuation, and spacing", () => {
    assert.equal(
      normalizeFollowUpTitle("Offer Kelsey two first-service slots"),
      normalizeFollowUpTitle("  offer kelsey two first service slots. "),
    );
  });

  it("keeps different follow-ups apart", () => {
    assert.notEqual(
      normalizeFollowUpTitle("Call Nina with estimate approval"),
      normalizeFollowUpTitle("Call Nina for tire and brake approval"),
    );
  });
});

describe("findMatchingFollowUp", () => {
  const open = [
    { title: "Send OTD quote and confirm 1:30 visit", dueLabel: "in 2 hours" },
    { title: "Text Marco when rear tire lands", dueLabel: "in 1 day" },
  ];

  it("finds the follow-up the brief is about to duplicate", () => {
    const match = findMatchingFollowUp("Send OTD quote and confirm 1:30 visit", open);

    assert.equal(match?.dueLabel, "in 2 hours");
  });

  it("matches through punctuation and casing differences", () => {
    assert.ok(findMatchingFollowUp("send otd quote and confirm 1:30 visit.", open));
  });

  it("leaves a genuinely new follow-up alone", () => {
    assert.equal(findMatchingFollowUp("Confirm rear tire ETA and update Marco", open), null);
  });

  it("treats a missing or blank suggestion as no match", () => {
    assert.equal(findMatchingFollowUp(null, open), null);
    assert.equal(findMatchingFollowUp("   ", open), null);
    assert.equal(findMatchingFollowUp("Anything", []), null);
  });
});

describe("defaultFollowUpDueDate", () => {
  it("uses the end of today when there is still a working afternoon left", () => {
    assert.equal(defaultFollowUpDueDate(new Date(2026, 7, 12, 9, 15)), "2026-08-12T17:00");
  });

  it("rolls to tomorrow morning once the end of today is under two hours out", () => {
    assert.equal(defaultFollowUpDueDate(new Date(2026, 7, 12, 15, 30)), "2026-08-13T09:00");
    assert.equal(defaultFollowUpDueDate(new Date(2026, 7, 12, 21, 0)), "2026-08-13T09:00");
  });

  it("rolls across a month boundary", () => {
    assert.equal(defaultFollowUpDueDate(new Date(2026, 7, 31, 18, 0)), "2026-09-01T09:00");
  });

  it("always lands in the future", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(2026, 7, 12, hour, 0);
      const due = new Date(defaultFollowUpDueDate(now));

      assert.ok(due.getTime() > now.getTime(), `hour ${hour} produced a due date in the past`);
    }
  });
});
