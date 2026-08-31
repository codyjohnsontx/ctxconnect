import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultFollowUpDueDate,
  findMatchingFollowUp,
  followUpSnoozeOptions,
  instantFromDateTimeLocal,
  instantFromZonedIso,
  normalizeFollowUpTitle,
  toDateTimeLocalValue,
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

describe("toDateTimeLocalValue", () => {
  // The reschedule field is seeded from the date the follow-up already carries,
  // so a value that loses the time - or gains a timezone shift - would quietly
  // move a follow-up the advisor only opened to look at.
  it("round-trips a stored due date through the picker unchanged", () => {
    const stored = new Date(2026, 7, 12, 17, 0);

    assert.equal(toDateTimeLocalValue(stored), "2026-08-12T17:00");
    assert.equal(new Date(toDateTimeLocalValue(stored)).getTime(), stored.getTime());
  });

  it("pads single-digit months, days, hours and minutes", () => {
    assert.equal(toDateTimeLocalValue(new Date(2026, 0, 3, 9, 5)), "2026-01-03T09:05");
  });
});

describe("followUpSnoozeOptions", () => {
  it("offers tomorrow and a week out, both at opening time", () => {
    assert.deepEqual(followUpSnoozeOptions(new Date(2026, 7, 12, 15, 30)), [
      { label: "Tomorrow", value: "2026-08-13T09:00" },
      { label: "In a week", value: "2026-08-19T09:00" },
    ]);
  });

  it("crosses month and year boundaries", () => {
    assert.deepEqual(followUpSnoozeOptions(new Date(2026, 11, 28, 8, 0)), [
      { label: "Tomorrow", value: "2026-12-29T09:00" },
      { label: "In a week", value: "2027-01-04T09:00" },
    ]);
  });

  // A follow-up moved to a moment that has already passed is still overdue, so
  // the whole point of the press would be lost.
  it("always lands in the future, whatever hour she presses it", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(2026, 7, 12, hour, 30);

      for (const option of followUpSnoozeOptions(now)) {
        assert.ok(
          new Date(option.value).getTime() > now.getTime(),
          `${option.label} at hour ${hour} produced a date in the past`,
        );
      }
    }
  });
});

// The advisor picks a wall clock in her own timezone and the server that stores
// it runs in UTC. These two functions are the whole of that trip: the browser
// turns her pick into an instant, and the server action refuses anything that
// did not arrive as one. Reading a bare local value on the server is the defect
// they exist to make impossible - a follow-up she set for 5pm stored as 5pm UTC
// is a follow-up that comes due at lunchtime.
function inTimeZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;

  try {
    return run();
  } finally {
    process.env.TZ = previous;
  }
}

describe("instantFromDateTimeLocal", () => {
  it("reads the picker's value as her wall clock, wherever she is", () => {
    assert.equal(
      inTimeZone("America/Chicago", () =>
        instantFromDateTimeLocal("2026-08-31T17:00")?.toISOString(),
      ),
      "2026-08-31T22:00:00.000Z",
    );
    assert.equal(
      inTimeZone("UTC", () => instantFromDateTimeLocal("2026-08-31T17:00")?.toISOString()),
      "2026-08-31T17:00:00.000Z",
    );
  });

  it("reads it against the offset in force on that date, not today's", () => {
    // Central standard time in January, daylight time in August: a fixed offset
    // would be wrong for half the year.
    assert.equal(
      inTimeZone("America/Chicago", () =>
        instantFromDateTimeLocal("2026-01-15T17:00")?.toISOString(),
      ),
      "2026-01-15T23:00:00.000Z",
    );
  });

  it("refuses anything that is not a bare wall-clock value", () => {
    assert.equal(instantFromDateTimeLocal(""), null);
    assert.equal(instantFromDateTimeLocal("tomorrow"), null);
    assert.equal(instantFromDateTimeLocal("2026-08-31"), null);
    // Already zoned: it came from somewhere other than the picker, and reading
    // it as local time would move it.
    assert.equal(instantFromDateTimeLocal("2026-08-31T17:00Z"), null);
  });
});

describe("instantFromZonedIso", () => {
  it("accepts an instant that names its offset", () => {
    assert.equal(
      instantFromZonedIso("2026-08-31T22:00:00.000Z")?.toISOString(),
      "2026-08-31T22:00:00.000Z",
    );
    assert.equal(
      instantFromZonedIso("2026-08-31T17:00:00-05:00")?.toISOString(),
      "2026-08-31T22:00:00.000Z",
    );
  });

  // The regression this pair exists for: a bare local value reaching the write
  // is read in the server's timezone, so the same string stores two different
  // instants depending on where the server is standing.
  it("refuses a bare local value, in every timezone the server might run in", () => {
    for (const timeZone of ["UTC", "America/Chicago", "Asia/Tokyo"]) {
      assert.equal(
        inTimeZone(timeZone, () => instantFromZonedIso("2026-08-31T17:00")),
        null,
        `a bare local value was accepted while the server was in ${timeZone}`,
      );
    }
  });

  it("refuses nothing, and refuses rubbish", () => {
    assert.equal(instantFromZonedIso(""), null);
    assert.equal(instantFromZonedIso("next Thursday"), null);
  });
});
