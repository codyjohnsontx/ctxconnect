import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeNotificationFacts,
  notificationFactKey,
} from "../src/lib/notification-facts";

// Attend stores one alert row per recipient, so a single fact - a thread with
// no owner, a text that failed, a follow-up past its time - arrives at the
// advisor's rail once per manager plus once for herself. These pin the rule
// that turns those rows back into the facts she actually has to act on: the
// same fact is never listed twice, a follow-up is never both still coming and
// already late, and two genuinely different facts are never merged.

const managerA = "manager-a";
const managerB = "manager-b";
const advisor = "advisor";

function alert(
  type: string,
  recipientUserId: string,
  ids: { conversationId?: string; taskId?: string; messageId?: string } = {},
) {
  return {
    type,
    recipientUserId,
    conversationId: ids.conversationId ?? null,
    taskId: ids.taskId ?? null,
    messageId: ids.messageId ?? null,
  };
}

describe("notificationFactKey", () => {
  it("gives every copy of one fact the same key", () => {
    const key = notificationFactKey(alert("SLA_MISSED", managerA, { conversationId: "c1" }));

    assert.equal(notificationFactKey(alert("SLA_MISSED", managerB, { conversationId: "c1" })), key);
    assert.equal(notificationFactKey(alert("SLA_MISSED", advisor, { conversationId: "c1" })), key);
  });

  it("treats due today and overdue as one follow-up", () => {
    assert.equal(
      notificationFactKey(alert("FOLLOW_UP_DUE", advisor, { conversationId: "c1", taskId: "t1" })),
      notificationFactKey(alert("FOLLOW_UP_OVERDUE", advisor, { conversationId: "c1", taskId: "t1" })),
    );
  });

  it("keeps different facts apart", () => {
    const sla = notificationFactKey(alert("SLA_MISSED", managerA, { conversationId: "c1" }));

    // Same alert on another thread.
    assert.notEqual(
      notificationFactKey(alert("SLA_MISSED", managerA, { conversationId: "c2" })),
      sla,
    );
    // Another alert on the same thread.
    assert.notEqual(
      notificationFactKey(alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "c1" })),
      sla,
    );
    // Two follow-ups on one thread.
    assert.notEqual(
      notificationFactKey(alert("FOLLOW_UP_DUE", advisor, { conversationId: "c1", taskId: "t1" })),
      notificationFactKey(alert("FOLLOW_UP_DUE", advisor, { conversationId: "c1", taskId: "t2" })),
    );
    // Two texts that failed in one thread.
    assert.notEqual(
      notificationFactKey(alert("MESSAGE_FAILED", managerA, { conversationId: "c1", messageId: "m1" })),
      notificationFactKey(alert("MESSAGE_FAILED", managerA, { conversationId: "c1", messageId: "m2" })),
    );
  });

  it("does not confuse an absent id with a different one", () => {
    // A blank id must not slide into the neighbouring field and make two
    // unrelated alerts look like one.
    assert.notEqual(
      notificationFactKey({ type: "X", conversationId: "a", taskId: null }),
      notificationFactKey({ type: "X", conversationId: null, taskId: "a" }),
    );
  });
});

describe("dedupeNotificationFacts", () => {
  it("lists a fact copied to every manager exactly once", () => {
    const rows = [
      alert("SLA_MISSED", managerA, { conversationId: "c1" }),
      alert("SLA_MISSED", managerB, { conversationId: "c1" }),
      alert("SLA_MISSED", advisor, { conversationId: "c1" }),
    ];

    assert.equal(dedupeNotificationFacts(rows, advisor).length, 1);
  });

  it("leaves a list that already holds one row per fact alone", () => {
    const rows = [
      alert("SLA_MISSED", advisor, { conversationId: "c1" }),
      alert("MESSAGE_FAILED", advisor, { conversationId: "c2", messageId: "m1" }),
      alert("UNASSIGNED_CONVERSATION", advisor, { conversationId: "c3" }),
    ];

    assert.deepEqual(dedupeNotificationFacts(rows, advisor), rows);
  });

  it("keeps the order the rows arrived in", () => {
    const rows = [
      alert("SLA_MISSED", managerA, { conversationId: "c1" }),
      alert("MESSAGE_FAILED", managerA, { conversationId: "c2", messageId: "m1" }),
      alert("SLA_MISSED", managerB, { conversationId: "c1" }),
      alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "c3" }),
    ];

    assert.deepEqual(
      dedupeNotificationFacts(rows, advisor).map((row) => row.type),
      ["SLA_MISSED", "MESSAGE_FAILED", "UNASSIGNED_CONVERSATION"],
    );
  });

  it("shows the reader the copy addressed to her", () => {
    const rows = [
      alert("SLA_MISSED", managerA, { conversationId: "c1" }),
      alert("SLA_MISSED", advisor, { conversationId: "c1" }),
    ];

    assert.deepEqual(dedupeNotificationFacts(rows, advisor), [rows[1]]);
  });

  it("reports a follow-up that is late as late, whoever it is addressed to", () => {
    const ids = { conversationId: "c1", taskId: "t1" };
    const rows = [
      alert("FOLLOW_UP_DUE", advisor, ids),
      alert("FOLLOW_UP_DUE", managerA, ids),
      alert("FOLLOW_UP_OVERDUE", managerA, ids),
      alert("FOLLOW_UP_OVERDUE", advisor, ids),
    ];

    const kept = dedupeNotificationFacts(rows, advisor);

    assert.equal(kept.length, 1);
    assert.equal(kept[0].type, "FOLLOW_UP_OVERDUE");
    assert.equal(kept[0].recipientUserId, advisor);
  });

  it("prefers the late row over the reader's own due-today row", () => {
    const ids = { conversationId: "c1", taskId: "t1" };
    const kept = dedupeNotificationFacts(
      [alert("FOLLOW_UP_DUE", advisor, ids), alert("FOLLOW_UP_OVERDUE", managerA, ids)],
      advisor,
    );

    assert.deepEqual(kept.map((row) => row.type), ["FOLLOW_UP_OVERDUE"]);
  });

  it("works without a reader, which is how the counters use it", () => {
    const rows = [
      alert("SLA_MISSED", managerA, { conversationId: "c1" }),
      alert("SLA_MISSED", managerB, { conversationId: "c1" }),
      alert("FOLLOW_UP_DUE", managerA, { conversationId: "c2", taskId: "t1" }),
      alert("FOLLOW_UP_OVERDUE", managerA, { conversationId: "c2", taskId: "t1" }),
    ];

    assert.equal(dedupeNotificationFacts(rows).length, 2);
  });

  it("handles an empty list", () => {
    assert.deepEqual(dedupeNotificationFacts([], advisor), []);
  });
});
