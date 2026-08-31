import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { dealershipTimeZone, endOfDealershipDay } from "../src/lib/dealership-day";

// A due date is an instant, and an instant is not a day until something picks a
// timezone to read it in. Three surfaces used to pick the server's, which is
// UTC on Vercel and never the advisor's: the Command Center "due today" metric
// and its list, the sweep that raises FOLLOW_UP_DUE, and the printed due date.
//
// Reproduced with the server in UTC and the browser in America/Chicago: a
// follow-up she set for 8pm dropped out of "due today" and never alerted,
// because the instant it names is after midnight UTC, and one she set for 10pm
// the night before printed as "due 8/31/2026, 3:00:00 AM" - the wrong day.
//
// The first two are answered on the dealership's day, below. The third is the
// viewer's own clock, and is pinned by the render scan at the bottom.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** What `timeZone` reads on the wall at `instant`, to the second. */
function wallClock(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(instant);
}

describe("when the dealership's day ends", () => {
  it("closes the day the advisor is standing in, not the one the server is", () => {
    // Her Monday afternoon; the server's Monday evening. Both agree it is the
    // 31st, and they disagree about when the 31st runs out.
    const now = new Date("2026-08-31T20:24:58.000Z");

    assert.equal(
      endOfDealershipDay(now, "America/Chicago").toISOString(),
      "2026-09-01T04:59:59.999Z",
    );
  });

  it("keeps an evening follow-up on the day it was set for", () => {
    // The reproduction, as a comparison the Prisma `lte` makes for real.
    const now = new Date("2026-08-31T20:24:58.000Z");
    const pickedAtEightPmCentral = new Date("2026-09-01T01:00:00.000Z");

    assert.ok(pickedAtEightPmCentral <= endOfDealershipDay(now, "America/Chicago"));

    // And what the server's own day used to say about the same follow-up.
    const serverDayEndInUtc = new Date("2026-08-31T23:59:59.999Z");
    assert.ok(pickedAtEightPmCentral > serverDayEndInUtc);
  });

  it("reads the offset in force at the end of the day, not the one in force now", () => {
    // The clocks move at 02:00 on both of these, so the offset at midday is not
    // the offset at midnight and a single reading is an hour out.
    assert.equal(
      endOfDealershipDay(new Date("2026-03-08T07:00:00.000Z"), "America/Chicago").toISOString(),
      "2026-03-09T04:59:59.999Z",
    );
    assert.equal(
      endOfDealershipDay(new Date("2026-11-01T06:00:00.000Z"), "America/Chicago").toISOString(),
      "2026-11-02T05:59:59.999Z",
    );
  });

  it("lands on the last moment of that day in every zone it is given", () => {
    const now = new Date("2026-08-31T20:24:58.000Z");

    // Behind UTC, ahead of it, half an hour off it, and a full day ahead: the
    // offset is read rather than assumed, so none of these is a special case.
    for (const timeZone of [
      "America/Chicago",
      "UTC",
      "Europe/Berlin",
      "Asia/Kolkata",
      "Pacific/Kiritimati",
    ]) {
      const end = endOfDealershipDay(now, timeZone);

      assert.match(wallClock(end, timeZone), /23:59:59$/, `${timeZone} does not end at midnight`);
      assert.equal(
        wallClock(end, timeZone).split(",")[0],
        wallClock(now, timeZone).split(",")[0],
        `${timeZone} ends on a different day than it is`,
      );
    }
  });
});

describe("which zone the dealership keeps", () => {
  it("defaults to the dealership's own", () => {
    assert.equal(dealershipTimeZone(), "America/Chicago");
  });

  it("takes a configured zone, and ignores a blank one", () => {
    const configured = process.env.DEALERSHIP_TIME_ZONE;

    try {
      process.env.DEALERSHIP_TIME_ZONE = " Europe/Berlin ";
      assert.equal(dealershipTimeZone(), "Europe/Berlin");

      // Unset and set-to-nothing are the same statement, and neither of them
      // means "read the server's clock".
      process.env.DEALERSHIP_TIME_ZONE = "   ";
      assert.equal(dealershipTimeZone(), "America/Chicago");
    } finally {
      if (configured === undefined) {
        delete process.env.DEALERSHIP_TIME_ZONE;
      } else {
        process.env.DEALERSHIP_TIME_ZONE = configured;
      }
    }
  });
});

function read(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

describe("the surfaces that decide whether a follow-up is due today", () => {
  it("asks the dealership's day for the Command Center metric and its list", () => {
    const data = read("src", "lib", "data.ts");

    assert.match(data, /endOfDealershipDay\(now\)/);
    // Both the count and the list have to read the same boundary; they sat on
    // the same screen disagreeing once already.
    assert.equal(data.match(/dueDate: \{ gte: now, lte: dueDayEnd \}/g)?.length, 2);
  });

  it("asks the dealership's day for the alert sweep", () => {
    const notifications = read("src", "lib", "notifications.ts");

    assert.match(notifications, /endOfDealershipDay\(now\)/);
    // The sweep has no viewer, so a server-clock day boundary here is not a
    // fallback - it is the bug.
    assert.doesNotMatch(notifications, /setHours\(/);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Generated Prisma client, not authored source.
      return entry.name === "generated" ? [] : sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Anything that turns a moment into words a person reads. `toLocaleString` is
 * only counted on a value the schema names like a moment - `dueDate`,
 * `createdAt` - because it is also how a mileage gets its thousands separator.
 */
const rendersAMoment = [
  /\.toLocaleDateString\s*\(/,
  /\.toLocaleTimeString\s*\(/,
  /\b\w*(Date|At)\??\.toLocaleString\s*\(/,
  /(?<!function )\bformatTimestamp\s*\(/,
];

describe("nothing prints a moment on the server's clock", () => {
  it("leaves every rendering of a moment to a client component", () => {
    // A server render has no idea what clock the advisor is reading, so the
    // only honest thing it can send is the instant. LocalTimestamp is where a
    // moment becomes words.
    const offenders = sourceFiles(join(repoRoot, "src"))
      .filter((path) => !/^\s*["']use client["']/.test(readFileSync(path, "utf8")))
      .filter((path) => rendersAMoment.some((pattern) => pattern.test(readFileSync(path, "utf8"))))
      .map((path) => relative(repoRoot, path));

    assert.deepEqual(offenders, []);
  });
});
