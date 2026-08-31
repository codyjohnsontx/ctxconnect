import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { instantFromDateTimeLocal, instantFromZonedIso } from "../src/lib/follow-ups";

// The defect these pin, driven end to end against the app before the fix: the
// dev server standing in UTC, the browser in America/Chicago, the service
// advisor creating a follow-up for half past midnight on 1 September. The create
// form posted the picker's bare "2026-09-01T00:30", createTask read it with
// new Date() wherever it happened to be standing, and the row stored
// 2026-09-01T00:30Z. Attend then showed her that follow-up as due half past
// seven on the evening of 31 August - five hours early, and the wrong day.
//
// rescheduleTask, written later, already refused a bare local value. These
// guard the pair staying refused, from both ends of the trip.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function inTimeZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;

  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }
}

describe("the date a follow-up is created with", () => {
  it("stores the instant she picked, with the server in another timezone", () => {
    // The browser converts, because it is the only side that knows her zone.
    const posted: string = inTimeZone(
      "America/Chicago",
      () => instantFromDateTimeLocal("2026-09-01T00:30")?.toISOString() ?? "",
    );

    assert.equal(posted, "2026-09-01T05:30:00.000Z");

    // The server reads what it was handed, and lands on the same instant from
    // wherever it is standing.
    for (const timeZone of ["UTC", "America/Chicago", "Asia/Tokyo"]) {
      const stored = inTimeZone(timeZone, (): Date | null => instantFromZonedIso(posted));

      assert.equal(
        stored?.toISOString(),
        "2026-09-01T05:30:00.000Z",
        `the server in ${timeZone} stored a different instant`,
      );
    }
  });

  it("refuses the bare local value that put it on the wrong day", () => {
    assert.equal(
      inTimeZone("UTC", () => instantFromZonedIso("2026-09-01T00:30")),
      null,
    );
  });
});

// The two assertions above only hold while the create path keeps going through
// them. These are the textual guard that it does - best-effort, like the one
// over notification writers: a picker rendered by some other means, or a value
// read out of raw request body, would slip past. The point is that the obvious
// way to reintroduce this fails.

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

const scanned = ["src"]
  .filter((dir) => existsSync(join(repoRoot, dir)))
  .flatMap((dir) => sourceFiles(join(repoRoot, dir)))
  .map((path) => relative(repoRoot, path))
  .sort();

function read(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("nothing hands a server action a wall clock", () => {
  it("renders every date picker where the timezone is known", () => {
    // A `datetime-local` value means nothing without the zone it was picked in,
    // and a server component cannot supply one. Rendering the picker from a
    // client component is what makes the conversion possible at all - the create
    // form's due date used to be rendered and defaulted on the server, which is
    // how both halves of it were the server's own clock.
    const pickers = scanned.filter((path) => read(path).includes('type="datetime-local"'));

    assert.deepEqual(
      pickers,
      [
        join("src", "components", "follow-up-due-date.tsx"),
        join("src", "components", "reschedule-follow-up.tsx"),
      ].sort(),
      "a date picker moved, or a new one appeared - it has to be in a client component",
    );

    for (const path of pickers) {
      assert.match(read(path), /^"use client";/, `${path} renders a picker on the server`);
    }
  });

  it("posts no due date under a name of its own", () => {
    // The picker itself carries no name. What is posted is the hidden field
    // beside it, holding the instant, so there is no bare value in the form data
    // for a writer to pick up by mistake.
    const named = scanned.filter((path) => /name="due(?!At")/.test(read(path)));

    assert.deepEqual(named, []);
  });

  it("reads every due date it is sent through the instant reader", () => {
    const actions = scanned.filter((path) => read(path).includes('"use server"'));

    assert.deepEqual(actions, [join("src", "app", "actions.ts")]);

    for (const path of actions) {
      const source = read(path);
      const reads = source.match(/formData\.get\("due[^"]*"\)/g) ?? [];

      // Both writers: the one that sets a follow-up's first date and the one
      // that moves it.
      assert.deepEqual(reads, ['formData.get("dueAt")', 'formData.get("dueAt")']);

      for (const line of source.split("\n")) {
        if (!line.includes('formData.get("due')) {
          continue;
        }

        assert.match(
          line,
          /instantFromZonedIso\(/,
          `${path} reads a due date without demanding an offset: ${line.trim()}`,
        );
      }
    }
  });
});
