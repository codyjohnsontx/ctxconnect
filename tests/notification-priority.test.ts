import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  notificationPriority,
  subjectRankedNotificationTypes,
} from "../src/lib/notification-facts";
import { NotificationType, Priority } from "../src/generated/prisma/enums";

// An unowned thread is raised by two writers: the Twilio inbound webhook the
// moment a text lands, and the operational sweep on every Command Center load.
// They agreed about what the alert was about and disagreed about how it ranked
// - the sweep passed the thread's own priority, the webhook hard-coded HIGH.
//
// Nothing reconciled them. The two rows are different rows, because a thread
// alert keeps the text it was raised from, and the read side collapses them to
// one fact only after reading rows in priority order - so the HIGH copy is the
// one the rail shows, sitting ahead of every genuinely-NORMAL alert in a list
// that stops at a fixed number of rows. Observed on a seeded dealership: a LOW
// thread texted through the webhook listed HIGH, and three sweeps in a row left
// it there.
//
// The rank is no longer a writer's to choose. It is derived from the fact - the
// type, plus how the thread or follow-up behind it is ranked - so the two
// writers cannot differ, and a rank that has gone stale is brought up to date
// the next time the fact is raised rather than standing for good.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// Same reach as tests/notification-write-shape.test.ts: alerts are raised from
// src/, but prisma/ and scripts/ hold code that writes to the same database.
const scannedDirs = ["src", "prisma", "scripts"];

function scannedSourceFiles(): string[] {
  return scannedDirs
    .filter((dir) => existsSync(join(repoRoot, dir)))
    .flatMap((dir) => sourceFiles(join(repoRoot, dir)));
}

describe("how an alert ranks", () => {
  it("gives an unowned thread the rank of the thread", () => {
    // The defect, as one line. The webhook's answer used to be HIGH whatever
    // this thread was worth.
    for (const subjectPriority of Object.values(Priority)) {
      assert.equal(
        notificationPriority(NotificationType.UNASSIGNED_CONVERSATION, subjectPriority),
        subjectPriority,
      );
    }
  });

  it("keeps the ranks that belong to the event rather than to the thread", () => {
    // A missed clock, a text that never arrived and a follow-up past its time
    // are severities of their own, and outrank a quiet thread deliberately.
    assert.equal(notificationPriority(NotificationType.SLA_MISSED, Priority.LOW), Priority.URGENT);
    assert.equal(notificationPriority(NotificationType.MESSAGE_FAILED, Priority.LOW), Priority.HIGH);
    assert.equal(
      notificationPriority(NotificationType.FOLLOW_UP_OVERDUE, Priority.LOW),
      Priority.HIGH,
    );
  });

  it("sorts every alert type into inherited or its own, so a new one is a decision", () => {
    assert.deepEqual(subjectRankedNotificationTypes, [
      NotificationType.NEW_INBOUND_MESSAGE,
      NotificationType.CONVERSATION_ASSIGNED,
      NotificationType.CONVERSATION_REASSIGNED,
      NotificationType.FOLLOW_UP_DUE,
      NotificationType.UNASSIGNED_CONVERSATION,
    ]);
  });

  it("answers the same for one fact however many writers ask", () => {
    // The webhook has the conversation in hand and so does the sweep, so the
    // one input they both supply is the one input the rank is made of.
    const asked = new Set(
      [1, 2, 3].map(() =>
        notificationPriority(NotificationType.UNASSIGNED_CONVERSATION, Priority.LOW),
      ),
    );

    assert.equal(asked.size, 1);
  });
});

// The rule above only binds writers that go through it. These are the guards
// that a writer cannot rank an alert itself, which is the form the defect took.
//
// Textual checks, not proofs, in the same spirit as the scans in
// tests/notification-write-shape.test.ts and tests/dealership-day.test.ts: they
// match the code as it is written today, and the point is that the obvious way
// to reintroduce the defect fails here.
describe("no writer ranks an alert itself", () => {
  const raisesAlerts = /\bnotify(Managers|Assignee)(Tx)?\s*\(/;
  const buildsRows = /\bnotification\.(create|createMany|createManyAndReturn|upsert)\b/;
  // A rank handed in as a constant, under either the field name a draft uses or
  // the column name a hand-built row uses. `overdue ? Priority.HIGH : ...` is
  // caught too, which is how the sweep used to rank a late follow-up.
  const constantRank = /\b(?:subjectP|p)riority:[^,\n]*\bPriority\.[A-Z]/;
  const readsTheRule = /\bnotificationPriority\b/;

  const files = scannedSourceFiles().map((path) => relative(repoRoot, path));
  const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

  const alertWriters = files.filter((path) => raisesAlerts.test(read(path))).sort();
  const rowWriters = files.filter((path) => buildsRows.test(read(path))).sort();

  it("finds the alert writers where they are expected", () => {
    // The four surfaces that raise alerts as the app runs, plus the module they
    // all raise them through. A sixth name is a writer to look at.
    assert.deepEqual(
      alertWriters,
      [
        join("src", "app", "actions.ts"),
        join("src", "app", "api", "messages", "send", "route.ts"),
        join("src", "app", "api", "twilio", "inbound", "route.ts"),
        join("src", "app", "api", "twilio", "status", "route.ts"),
        join("src", "lib", "notifications.ts"),
      ].sort(),
    );

    // And the one writer that builds rows itself: the demo seed, which
    // fabricates a dataset against an empty database rather than raising alerts
    // as the app runs.
    assert.deepEqual(rowWriters, [
      join("src", "lib", "demo-seed.ts"),
      join("src", "lib", "notifications.ts"),
    ].sort());
  });

  it("hands no alert a rank of its own choosing", () => {
    // Whole-file, because nothing in these five files writes a priority for any
    // reason other than raising an alert - which is what makes the strongest
    // form of the check available here.
    const offenders = alertWriters.filter((path) => constantRank.test(read(path)));

    assert.deepEqual(
      offenders,
      [],
      "an alert's rank comes from notificationPriority, never from a constant at the call site",
    );
  });

  it("hands no hand-built row a rank of its own choosing", () => {
    // The seed writes conversations and follow-ups in the same file, and those
    // carry constant priorities legitimately - a demo dealership has to be
    // ranked by somebody. So this reads only the rows that are alerts: the text
    // following each call to the one subject constructor.
    const rowWindow = 900;
    const offenders = rowWriters.filter((path) => {
      const source = read(path);

      return source
        .split("notificationSubjectColumns(")
        .slice(1)
        .some((tail) => constantRank.test(tail.slice(0, rowWindow)));
    });

    assert.deepEqual(offenders, []);
  });

  it("makes the writer that builds rows by hand read the rule", () => {
    const offenders = rowWriters.filter((path) => !readsTheRule.test(read(path)));

    assert.deepEqual(offenders, []);
  });
});
