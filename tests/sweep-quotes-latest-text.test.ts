import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeNotificationFacts,
  notificationSubjectColumns,
  quotedCustomerText,
  supersededNotificationCopies,
  type CustomerText,
} from "../src/lib/notification-facts";
import { Department, NotificationType, Priority } from "../src/generated/prisma/enums";

// The operational sweep raises an unowned thread's alert on every Command Center
// load, and it used to have no text to give it, so it said "X is waiting without
// an owner." On a thread the customer texted while it had an owner, that was all
// a manager ever read once it was set to unassigned: the texts had raised alerts
// addressed to the owner, setting it unassigned withdrew the unowned-thread
// copies, and nothing brought one back that quoted the customer. The read side
// prefers a copy that quotes a text, but it cannot choose one that was never
// written. The owner's call (2026-09-12): the sweep quotes the latest text itself.
//
// Which text the sweep's one statement returns - the newest of several - is a
// question for Postgres, which this suite cannot ask; it was checked against a
// real one.

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
const after = (instant: Date, ms: number) => new Date(instant.getTime() + ms);

const thread = {
  id: "c1",
  department: Department.PARTS,
  priority: Priority.NORMAL,
  customer: { name: "Marco Silva" },
};

const earlierText = {
  id: "m2",
  body: "Do you have front pads for the Tracer 9 in stock?",
  mediaUrl: null,
  createdAt: after(now, -90 * 60_000),
};
const latestText = {
  id: "m3",
  body: "Actually I can come by at 4 today to pick them up.",
  mediaUrl: null,
  createdAt: after(now, -5 * 60_000),
};

// The copy src/app/api/twilio/inbound/route.ts raises on an unowned thread as a
// text lands.
function webhookAlert(text: CustomerText): SweepDraft {
  return {
    type: NotificationType.UNASSIGNED_CONVERSATION,
    title: "New unassigned customer message",
    ...quotedCustomerText(thread.customer.name, text),
    conversationId: thread.id,
    department: thread.department,
    subjectPriority: thread.priority,
  };
}

// One manager's stored copy of a draft, as far as the rail reads one. A row its
// draft does not date is stamped as it is written.
async function stored(draft: SweepDraft, recipientUserId: string, writtenAt = now) {
  const { notificationRow } = await loadNotifications();
  const row = notificationRow({ ...draft, recipientUserId });

  return { ...row, createdAt: row.createdAt ?? writtenAt };
}

describe("the sweep's copy of an unowned thread's alert", () => {
  it("reads the customer's latest words on a thread texted while it had an owner", async () => {
    // Set to unassigned since, so the managers hold no copy quoting the customer
    // and the one the sweep writes is all their rail has to show.
    const { unassignedConversationAlert } = await loadNotifications();
    const draft = unassignedConversationAlert(thread, latestText, now);

    const kept = dedupeNotificationFacts(
      [await stored(draft, managerA), await stored(draft, managerB)],
      managerA,
    );

    assert.equal(kept.length, 1);
    assert.equal(kept[0].body, "Marco Silva: Actually I can come by at 4 today to pick them up.");
    assert.equal(kept[0].messageId, "m3");
  });

  it("is dated when the customer sent the text it quotes, not when the sweep wrote it", async () => {
    const { unassignedConversationAlert } = await loadNotifications();
    const row = await stored(unassignedConversationAlert(thread, latestText, now), managerA, now);

    assert.deepEqual(row.createdAt, latestText.createdAt);
  });

  it("keeps the generic line, dated when it is written, on a thread the customer has never texted", async () => {
    const { unassignedConversationAlert } = await loadNotifications();
    const draft = unassignedConversationAlert(thread, undefined, now);

    assert.equal(draft.body, "Marco Silva is waiting without an owner.");
    assert.equal(notificationSubjectColumns(draft).messageId, null);
    assert.deepEqual((await stored(draft, managerA, now)).createdAt, now);
  });

  it("stores the row it stored last time, and the row the webhook stored for that text", async () => {
    // Before it writes, the sweep looks for an outstanding row with these columns
    // for the recipient. A thread nothing has happened to builds the same columns
    // on every load, so the sweep finds its own row and writes nothing. And where
    // the webhook has already raised the thread for that text, the sweep's copy is
    // the webhook's row - it used to add its generic line beside it, once per
    // manager.
    const { unassignedConversationAlert } = await loadNotifications();
    const lastLoad = unassignedConversationAlert(thread, latestText, after(now, -60_000));
    const thisLoad = unassignedConversationAlert(thread, latestText, now);

    assert.deepEqual(notificationSubjectColumns(thisLoad), notificationSubjectColumns(lastLoad));
    assert.deepEqual(notificationSubjectColumns(thisLoad), notificationSubjectColumns(webhookAlert(latestText)));
  });
});

describe("a copy that quotes the customer", () => {
  it("names the very text its words are taken from, and when it was sent", () => {
    assert.deepEqual(quotedCustomerText("Marco Silva", latestText), {
      body: "Marco Silva: Actually I can come by at 4 today to pick them up.",
      raisedByMessageId: "m3",
      createdAt: latestText.createdAt,
    });
  });

  it("is dated by the text that just landed when the webhook raises it", async () => {
    const row = await stored(webhookAlert(latestText), managerA, after(latestText.createdAt, 40));

    assert.deepEqual(row.createdAt, latestText.createdAt);
  });

  it("never writes a blank quote for a message with no words", async () => {
    // A picture texted with no caption arrives from the webhook with an empty
    // body, and it is still the latest thing the customer sent, so the sweep
    // picks it. Quoting its words gave "Marco Silva: " and nothing after.
    const { unassignedConversationAlert } = await loadNotifications();
    const photo = {
      id: "m4",
      body: "",
      mediaUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1",
      createdAt: after(now, -2 * 60_000),
    };
    const blank = { ...photo, id: "m5", body: "   ", mediaUrl: null };

    assert.deepEqual(quotedCustomerText("Marco Silva", photo), {
      body: "Marco Silva sent a photo or file.",
      raisedByMessageId: "m4",
      createdAt: photo.createdAt,
    });
    assert.equal(quotedCustomerText("Marco Silva", blank).body, "Marco Silva sent a blank text.");
    assert.equal(unassignedConversationAlert(thread, photo, now).body, "Marco Silva sent a photo or file.");
  });
});

describe("an older quote written after a newer one", () => {
  it("still shows the customer's newer text", async () => {
    // The sweep read the thread just before m3 landed, so it quotes m2, and its
    // write reaches the database after the webhook's copy quoting m3. Every later
    // sweep quotes m3, finds the webhook's row and writes nothing, so what the
    // rail shows here it goes on showing.
    const { unassignedConversationAlert } = await loadNotifications();
    const webhook = await stored(webhookAlert(latestText), managerA, after(latestText.createdAt, 40));
    const sweep = await stored(
      unassignedConversationAlert(thread, earlierText, now),
      managerA,
      after(latestText.createdAt, 2_000),
    );

    for (const rows of [
      [webhook, sweep],
      [sweep, webhook],
    ]) {
      const kept = dedupeNotificationFacts(rows, managerA);

      assert.equal(kept.length, 1);
      assert.equal(kept[0].messageId, "m3");
    }
  });
});

describe("two texts stamped the same instant", () => {
  it("shows and keeps the text the sweep would quote, whichever copy is read first", async () => {
    // Each copy carries its text's time, so two texts sent in the same instant
    // leave copies that tie on it. The sweep's query settles the tie on the text
    // id, the greater one being the later text, so the rail and the hand-off must
    // settle it the same way - or the manager reads the text the sweep would not
    // have quoted, depending only on which copy a list happened to reach first.
    const instant = after(now, -10 * 60_000);
    const first = { id: "m2", body: "Are the pads in?", mediaUrl: null, createdAt: instant };
    const second = { id: "m3", body: "I can come by at 4.", mediaUrl: null, createdAt: instant };
    const rows = [
      await stored(webhookAlert(first), managerA),
      await stored(webhookAlert(second), managerA),
    ];
    const handedOver = [first, second].map((text) => ({
      id: `alert-${text.id}`,
      type: NotificationType.NEW_INBOUND_MESSAGE,
      conversationId: thread.id,
      taskId: null,
      messageId: text.id,
      createdAt: text.createdAt,
    }));

    for (const order of [rows, [...rows].reverse()]) {
      assert.equal(dedupeNotificationFacts(order, managerA)[0].messageId, "m3");
    }

    for (const order of [handedOver, [...handedOver].reverse()]) {
      assert.deepEqual(supersededNotificationCopies(order), ["alert-m2"]);
    }
  });
});
