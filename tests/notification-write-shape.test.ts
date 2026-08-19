import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  followUpTypes,
  notificationFactKey,
  notificationSubjectColumns,
  perMessageTypes,
} from "../src/lib/notification-facts";
import { NotificationType } from "../src/generated/prisma/enums";

// Two writers used to build these rows independently: the Twilio inbound
// webhook raises an unowned thread the moment a text lands and attached that
// text to the row, while the operational sweep raises the same thread on every
// Command Center load with no text at all. The rail listed that customer twice
// and the badge read one too many.
//
// That was closed at the read side - an unassigned-conversation fact is per
// conversation, so the key stopped reading the message. These close it at the
// write side: there is now one constructor for the columns that say what an
// alert is about, and a writer cannot hand it a message for an alert that is
// not about one. What is left for a writer to choose is the wording and the
// ranking, which the two of them legitimately differ on.

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

/** Whole enum members, so a new one has to be sorted rather than defaulting. */
const everyType = Object.values(NotificationType);

describe("what a notification row is about", () => {
  it("sorts every alert into exactly one of the two lists", () => {
    // The lists decide both how the key reads a row and what shape a writer may
    // build one in, so a type that is in neither is not a default - it is a
    // decision nobody has made. Adding one to the schema has to fail here.
    for (const type of everyType) {
      const inFollowUps = (followUpTypes as readonly string[]).includes(type);
      const inPerMessage = (perMessageTypes as readonly string[]).includes(type);

      assert.equal(inFollowUps && inPerMessage, false, `${type} is in both lists`);
    }

    assert.deepEqual(
      everyType.filter(
        (type) =>
          !(followUpTypes as readonly string[]).includes(type) &&
          !(perMessageTypes as readonly string[]).includes(type),
      ),
      [
        NotificationType.NEW_INBOUND_MESSAGE,
        NotificationType.CONVERSATION_ASSIGNED,
        NotificationType.CONVERSATION_REASSIGNED,
        NotificationType.SLA_MISSED,
        NotificationType.UNASSIGNED_CONVERSATION,
      ],
      "a new alert type has to be declared per-message, a follow-up, or about the thread",
    );
  });

  it("keeps a failed text's own message, because that is what the alert is", () => {
    assert.deepEqual(
      notificationSubjectColumns({
        type: NotificationType.MESSAGE_FAILED,
        conversationId: "c1",
        messageId: "m1",
      }),
      { type: NotificationType.MESSAGE_FAILED, conversationId: "c1", taskId: null, messageId: "m1" },
    );
  });

  it("records the text a thread alert was raised from without letting it into the fact", () => {
    // This is the shape the webhook writes and the shape the sweep writes, side
    // by side. The rows differ - one remembers the text it came from - and the
    // fact they describe must not.
    const fromWebhook = notificationSubjectColumns({
      type: NotificationType.UNASSIGNED_CONVERSATION,
      conversationId: "c1",
      raisedByMessageId: "m1",
    });
    const fromSweep = notificationSubjectColumns({
      type: NotificationType.UNASSIGNED_CONVERSATION,
      conversationId: "c1",
    });

    assert.equal(fromWebhook.messageId, "m1");
    assert.equal(fromSweep.messageId, null);
    assert.equal(notificationFactKey(fromWebhook), notificationFactKey(fromSweep));
  });

  it("gives a follow-up its task, and its thread only when it has one", () => {
    assert.deepEqual(
      notificationSubjectColumns({ type: NotificationType.FOLLOW_UP_DUE, taskId: "t1" }),
      { type: NotificationType.FOLLOW_UP_DUE, conversationId: null, taskId: "t1", messageId: null },
    );
    assert.equal(
      notificationSubjectColumns({
        type: NotificationType.FOLLOW_UP_OVERDUE,
        taskId: "t1",
        conversationId: "c1",
      }).conversationId,
      "c1",
    );
  });

  it("lands every alert type on one key however many writers raise it", () => {
    // A thread alert raised from any of five texts, and from none, is one fact.
    const raisedFrom = ["m1", "m2", "m3", "m4", "m5", null];

    for (const type of everyType) {
      if (
        (followUpTypes as readonly string[]).includes(type) ||
        (perMessageTypes as readonly string[]).includes(type)
      ) {
        continue;
      }

      const keys = new Set(
        raisedFrom.map((raisedByMessageId) =>
          notificationFactKey(
            notificationSubjectColumns({
              type: type as "SLA_MISSED",
              conversationId: "c1",
              raisedByMessageId,
            }),
          ),
        ),
      );

      assert.equal(keys.size, 1, `${type} split into ${keys.size} facts`);
    }
  });
});

// A writer that puts a message where the key reads it is what produced the
// double-count, so it has to stop compiling rather than stop passing review.
// Each of these fails `tsc --noEmit` the moment the shape stops being enforced,
// because an unused @ts-expect-error is itself an error.
describe("the wrong shape does not compile", () => {
  it("refuses a message on an alert that is about the thread", () => {
    // @ts-expect-error an unassigned-conversation fact is per conversation
    notificationSubjectColumns({
      type: NotificationType.UNASSIGNED_CONVERSATION,
      conversationId: "c1",
      messageId: "m1",
    });
  });

  it("refuses a message on a follow-up", () => {
    // @ts-expect-error a follow-up fact is the task, whatever raised the row
    notificationSubjectColumns({
      type: NotificationType.FOLLOW_UP_DUE,
      taskId: "t1",
      messageId: "m1",
    });
  });

  it("refuses provenance where the message is the fact", () => {
    // @ts-expect-error a failed text's message is the fact, not provenance
    notificationSubjectColumns({
      type: NotificationType.MESSAGE_FAILED,
      conversationId: "c1",
      messageId: "m1",
      raisedByMessageId: "m2",
    });
  });

  it("refuses a thread alert with no thread", () => {
    // @ts-expect-error a thread alert without its thread has no subject at all
    notificationSubjectColumns({ type: NotificationType.SLA_MISSED });
  });
});

// The type above only binds writers that go through it. This is the guard that
// a third writer cannot appear beside the two by assembling a row itself.
//
// It is a best-effort textual check, not a proof: it matches the Prisma create
// calls as they are written today, so a writer using raw SQL or an aliased
// client would slip past. Catching that would mean parsing TypeScript, which is
// not worth it here - the point is that the obvious way to add a writer fails.
describe("nothing builds a notification row on its own", () => {
  const creates = /\bnotification\.(create|createMany|createManyAndReturn|upsert)\b/;
  const constructor = /\bnotificationSubjectColumns\b/;

  const writers = sourceFiles(join(repoRoot, "src"))
    .map((path) => relative(repoRoot, path))
    .filter((path) => creates.test(readFileSync(join(repoRoot, path), "utf8")));

  it("finds the writers where they are expected", () => {
    // Two: the module every runtime alert is raised through, and the demo seed,
    // which fabricates a dataset against an empty database rather than raising
    // alerts as the app runs. A third name here is a new writer to look at.
    assert.deepEqual(writers, [join("src", "lib", "demo-seed.ts"), join("src", "lib", "notifications.ts")].sort());
  });

  it("builds their subject through the one constructor", () => {
    const offenders = writers.filter(
      (path) => !constructor.test(readFileSync(join(repoRoot, path), "utf8")),
    );

    assert.deepEqual(offenders, []);
  });
});
