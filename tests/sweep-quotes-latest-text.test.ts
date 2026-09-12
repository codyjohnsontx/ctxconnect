import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeNotificationFacts,
  latestCustomerTextsQuery,
  notificationPriority,
  notificationSubjectColumns,
  quotedCustomerText,
} from "../src/lib/notification-facts";
import { Department, MessageDirection, NotificationType, Priority } from "../src/generated/prisma/enums";

// The operational sweep raises an unowned thread's alert on every Command Center
// load, and it used to have no text to give it, so it said "X is waiting without
// an owner." On a thread the customer texted while it had an owner, that was all
// a manager ever read once it was set to unassigned: the texts had raised alerts
// addressed to the owner, setting it unassigned withdrew the unowned-thread
// copies, and nothing brought one back that quoted the customer. The read side
// prefers a copy that quotes a text, but it cannot choose one that was never
// written. The owner's call (2026-09-12): the sweep quotes the latest text itself.

// The module builds a Prisma client as it loads, which needs a connection string
// present but never opens it - the same arrangement as tests/demo-cap.test.ts.
// Nothing here touches the database.
async function loadNotifications() {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";

  return import("../src/lib/notifications");
}

type SweepDraft = ReturnType<
  Awaited<ReturnType<typeof loadNotifications>>["unassignedConversationAlert"]
>;

const managerA = "manager-a";
const managerB = "manager-b";
const now = new Date(Date.UTC(2026, 8, 12, 15, 0));

const thread = {
  id: "c1",
  department: Department.PARTS,
  priority: Priority.NORMAL,
  customer: { name: "Marco Silva" },
};

const latestText = { id: "m3", body: "Actually I can come by at 4 today to pick them up." };

// One manager's stored copy of a draft, as far as the rail reads one.
function stored(draft: SweepDraft, recipientUserId: string) {
  return {
    ...notificationSubjectColumns(draft),
    recipientUserId,
    body: draft.body ?? null,
    priority: notificationPriority(draft.type, draft.subjectPriority),
    createdAt: now,
  };
}

describe("the sweep's copy of an unowned thread's alert", () => {
  it("reads the customer's latest words on a thread texted while it had an owner", async () => {
    // Set to unassigned since, so the managers hold no copy quoting the customer
    // and the one the sweep writes is all their rail has to show.
    const { unassignedConversationAlert } = await loadNotifications();
    const draft = unassignedConversationAlert(thread, latestText, now);

    const kept = dedupeNotificationFacts([stored(draft, managerA), stored(draft, managerB)], managerA);

    assert.equal(kept.length, 1);
    assert.equal(kept[0].body, "Marco Silva: Actually I can come by at 4 today to pick them up.");
    assert.equal(kept[0].messageId, "m3");
  });

  it("keeps the generic line on a thread the customer has never texted", async () => {
    const { unassignedConversationAlert } = await loadNotifications();
    const draft = unassignedConversationAlert(thread, undefined, now);

    assert.equal(draft.body, "Marco Silva is waiting without an owner.");
    assert.equal(notificationSubjectColumns(draft).messageId, null);
  });

  it("stores the row it stored last time, and the row the webhook stored for that text", async () => {
    // Before it writes, the sweep looks for an outstanding row with these columns
    // for the recipient. A thread nothing has happened to builds the same columns
    // on every load, so the sweep finds its own row and writes nothing. And where
    // the webhook has already raised the thread for that text, the sweep's copy is
    // the webhook's row - it used to add its generic line beside it, once per
    // manager.
    const { unassignedConversationAlert } = await loadNotifications();
    const lastLoad = unassignedConversationAlert(thread, latestText, new Date(now.getTime() - 60_000));
    const thisLoad = unassignedConversationAlert(thread, latestText, now);
    // As src/app/api/twilio/inbound/route.ts raised it when the text landed.
    const webhook = {
      type: NotificationType.UNASSIGNED_CONVERSATION,
      conversationId: thread.id,
      raisedByMessageId: latestText.id,
    };

    assert.deepEqual(notificationSubjectColumns(thisLoad), notificationSubjectColumns(lastLoad));
    assert.deepEqual(notificationSubjectColumns(thisLoad), notificationSubjectColumns(webhook));
  });
});

describe("a copy that quotes the customer", () => {
  it("names the very text its words are taken from", () => {
    assert.deepEqual(quotedCustomerText("Marco Silva", latestText), {
      body: "Marco Silva: Actually I can come by at 4 today to pick them up.",
      raisedByMessageId: "m3",
    });
  });
});

// This suite has no database, so these pin the question the SQL asks. What
// Postgres answers - the newest of several texts, one row per thread - was
// checked against a real one.
describe("which text the sweep quotes", () => {
  const threads = ["c1", "c2", "c3"];
  const query = latestCustomerTextsQuery(threads);

  it("asks about every unowned thread in one statement", () => {
    assert.ok(query.values.some((value) => value === threads));
    assert.equal(query.values.includes("c1"), false, "a thread id bound on its own is a query shaped per thread");
  });

  it("reads only what the customer sent", () => {
    assert.ok(query.values.includes(MessageDirection.INBOUND));
  });

  it("takes each thread's most recent text, never its first", () => {
    assert.match(query.sql, /ORDER BY "createdAt" DESC\b/);
    assert.match(query.sql, /LIMIT 1\b/);
    assert.doesNotMatch(query.sql, /"createdAt" ASC\b/);
  });
});
