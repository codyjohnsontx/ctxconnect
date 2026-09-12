import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  notificationFactKey,
  notificationPriority,
  sameFactNotificationsWhere,
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
    // are severities of their own, and lift a quiet thread's alert deliberately.
    assert.equal(notificationPriority(NotificationType.SLA_MISSED, Priority.LOW), Priority.URGENT);
    assert.equal(notificationPriority(NotificationType.MESSAGE_FAILED, Priority.LOW), Priority.HIGH);
    assert.equal(
      notificationPriority(NotificationType.FOLLOW_UP_OVERDUE, Priority.LOW),
      Priority.HIGH,
    );
  });

  it("lets an event's own rank lower an urgent subject as well as lift a quiet one", () => {
    // A fixed rank replaces the subject's rather than setting a floor under it.
    // So an URGENT follow-up's alert reads URGENT while it is merely due and
    // HIGH once it is late: it sinks on the rail at the moment it goes late,
    // and a failed text on an URGENT thread reads HIGH rather than URGENT.
    // Pinned in this direction too, because it is what the rule computes today.
    assert.equal(
      notificationPriority(NotificationType.FOLLOW_UP_DUE, Priority.URGENT),
      Priority.URGENT,
    );
    assert.equal(
      notificationPriority(NotificationType.FOLLOW_UP_OVERDUE, Priority.URGENT),
      Priority.HIGH,
    );
    assert.equal(
      notificationPriority(NotificationType.MESSAGE_FAILED, Priority.URGENT),
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
});

// Agreeing at write time is only half of it. The other half is the scope a
// raise re-ranks over, which is what reaches a copy no writer will revisit.
describe("which rows one raise re-ranks", () => {
  const threadAlert = {
    conversationId: "conversation-1",
    taskId: null,
    messageId: "message-1",
  };

  it("reaches a thread alert whatever text raised it, so both writers' copies move together", () => {
    // The whole defect, at the scope level. The webhook's row carries the text
    // it was raised from and the sweep's carries none, so leaving the message
    // in would have left the webhook's copy standing at its old rank forever.
    assert.deepEqual(
      sameFactNotificationsWhere({
        ...threadAlert,
        type: NotificationType.UNASSIGNED_CONVERSATION,
      }),
      {
        type: NotificationType.UNASSIGNED_CONVERSATION,
        conversationId: "conversation-1",
        taskId: null,
      },
    );
  });

  it("does not constrain the recipient, so one raise converges every copy", () => {
    // A rank is recipient-independent by construction, so there is no copy this
    // may legitimately skip. The one it used to skip belonged to a manager since
    // deactivated: nothing resolves their rows, the sweep never raises for them
    // again, and a manager's rail reads every recipient's rows, so that stale
    // copy took the fact's slot at the top of the list.
    const clause = sameFactNotificationsWhere({
      ...threadAlert,
      type: NotificationType.UNASSIGNED_CONVERSATION,
    });

    assert.ok(!("recipientUserId" in clause));
  });

  it("keeps a failed text to its own row", () => {
    // Two failed texts on one thread are two things to fix, so re-ranking the
    // alert about one must not reach the alert about the other.
    assert.deepEqual(
      sameFactNotificationsWhere({ ...threadAlert, type: NotificationType.MESSAGE_FAILED }),
      {
        type: NotificationType.MESSAGE_FAILED,
        conversationId: "conversation-1",
        taskId: null,
        messageId: "message-1",
      },
    );
  });

  it("matches the type exactly, so a due follow-up and a late one do not merge", () => {
    // The read side collapses the two states of one follow-up into one fact on
    // purpose. The re-rank must not follow it there: they rank differently, so
    // re-ranking the due row has to leave the overdue row alone.
    const subject = {
      conversationId: "conversation-1",
      taskId: "task-1",
      messageId: null,
    };
    const due = { ...subject, type: NotificationType.FOLLOW_UP_DUE };
    const overdue = { ...subject, type: NotificationType.FOLLOW_UP_OVERDUE };

    assert.notDeepEqual(sameFactNotificationsWhere(due), sameFactNotificationsWhere(overdue));
    assert.equal(notificationFactKey(due), notificationFactKey(overdue));
  });
});

// The rule above binds a writer only where the writer goes through it. Two
// scans cover the two ways a rank can still be written around it.
//
// The compiler enforces whatever `NotificationDetails` says today, and it says
// nothing about `priority`, so a rank passed at a call site does not compile.
// What the compiler cannot object to is that type being widened to accept one
// again, and the first scan is what still fails once it has been. The second
// covers src/lib/demo-seed.ts, which bypasses the draft type altogether by
// calling `prisma.notification.create` with a raw row: Prisma's own input type
// has a `priority` field, legitimately, so there is nothing there for the
// compiler to catch at all.
//
// Textual checks rather than proofs, the same bar as the scans in
// tests/notification-write-shape.test.ts and tests/dealership-day.test.ts.
describe("no writer ranks an alert itself", () => {
  const raisesAlerts = /\bnotify(Managers|Assignee)(Tx)?\s*\(/;
  const buildsRows = /\bnotification\.(create|createMany|createManyAndReturn|upsert)\b/;
  // A rank handed in as a constant, under either the field name a draft uses or
  // the column name a hand-built row uses. `overdue ? Priority.HIGH : ...` is
  // caught too, which is how the sweep used to rank a late follow-up.
  //
  // The value runs to the next `,`, `}` or `;` rather than to the end of the
  // line, because a formatter is free to wrap a long property onto the line
  // below and a guard that stops at the newline would read `subjectPriority:\n
  // Priority.HIGH` as clean. Those three terminators are what keep the value
  // inside its own property once it may span lines: a comma ends a member of an
  // object literal, and a semicolon ends one of a type literal, which is the
  // shape `NotificationDetails` declares `subjectPriority` in and which no comma
  // ever closes.
  const constantRank = /\b(?:subjectP|p)riority\s*:[^,};]*\bPriority\.[A-Z]/;

  const files = scannedSourceFiles().map((path) => relative(repoRoot, path));
  const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

  const alertWriters = files.filter((path) => raisesAlerts.test(read(path))).sort();
  const rowWriters = files.filter((path) => buildsRows.test(read(path))).sort();

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
});
