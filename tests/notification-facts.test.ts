import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeNotificationsWhere,
  dedupeNotificationFacts,
  followUpSubject,
  followUpTypes,
  notificationFactCountQuery,
  notificationFactKey,
  notificationScopeWhere,
  perMessageTypes,
  readResolvesNotificationTypes,
} from "../src/lib/notification-facts";
import { NotificationType } from "../src/generated/prisma/enums";
import type { Prisma } from "../src/generated/prisma/client";

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

  // What makes two rows one fact is the thread, not the message that raised
  // them. Both writers of an unowned thread and every text arriving on a busy
  // thread have to land on one key, or the rail lists a customer twice and the
  // badge counts a day of texts as a day of work.
  it("counts an unowned thread once however the row that raised it was written", () => {
    // The webhook attaches the inbound message to its row; the operational
    // sweep raises the same thread with no message at all.
    assert.equal(
      notificationFactKey(
        alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "c1", messageId: "m1" }),
      ),
      notificationFactKey(alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "c1" })),
    );
  });

  it("counts a thread's unanswered texts as one thread to answer", () => {
    const keys = new Set(
      ["m1", "m2", "m3", "m4", "m5"].map((messageId) =>
        notificationFactKey(alert("NEW_INBOUND_MESSAGE", advisor, { conversationId: "c1", messageId })),
      ),
    );

    assert.equal(keys.size, 1);
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

  it("lists an unowned thread once, in both the shapes it is stored in", () => {
    const rows = [
      {
        ...alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "c1", messageId: "m1" }),
        title: "New unassigned customer message",
      },
      {
        ...alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "c1" }),
        title: "Unassigned conversation",
      },
    ];

    assert.equal(dedupeNotificationFacts(rows, advisor).length, 1);
  });

  it("lists a thread that took five texts as one thread waiting on her", () => {
    const rows = ["m1", "m2", "m3", "m4", "m5"].map((messageId) =>
      alert("NEW_INBOUND_MESSAGE", advisor, { conversationId: "c1", messageId }),
    );

    assert.equal(dedupeNotificationFacts(rows, advisor).length, 1);
  });

  it("keeps two failed texts on one thread as two things to fix", () => {
    const rows = [
      alert("MESSAGE_FAILED", managerA, { conversationId: "c1", messageId: "m1" }),
      alert("MESSAGE_FAILED", managerA, { conversationId: "c1", messageId: "m2" }),
    ];

    assert.equal(dedupeNotificationFacts(rows, advisor).length, 2);
  });

  it("handles an empty list", () => {
    assert.deepEqual(dedupeNotificationFacts([], advisor), []);
  });
});

// The rail's badge and the rail's list ask the same question - what is still
// waiting on this member of staff - so they now ask it with one clause. These
// run that clause against rows rather than checking its shape, because the
// mistake it replaced was a clause that read correctly and matched the whole
// dealership.
type AlertRow = {
  recipientUserId: string | null;
  department: string | null;
  status: string;
};

function matches(where: Prisma.NotificationWhereInput, row: AlertRow): boolean {
  const clause = where as Record<string, unknown>;

  if (Array.isArray(clause.AND)) {
    return (clause.AND as Prisma.NotificationWhereInput[]).every((part) => matches(part, row));
  }

  if (Array.isArray(clause.OR)) {
    return (clause.OR as Prisma.NotificationWhereInput[]).some((part) => matches(part, row));
  }

  const conditions = Object.entries(clause).map(([field, expected]) => {
    const actual = row[field as keyof AlertRow];

    if (expected && typeof expected === "object" && "not" in expected) {
      return actual !== (expected as { not: unknown }).not;
    }

    return actual === expected;
  });

  // An empty clause is Prisma's "match everything", which is what a missing
  // department must never turn a reader's scope into.
  return conditions.every(Boolean);
}

const serviceAdvisor = { id: advisor, role: "STAFF", department: "SERVICE" };
const manager = { id: "manager", role: "MANAGER", department: "SALES" };
const floater = { id: "floater", role: "STAFF", department: null };

function alertRow(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    recipientUserId: managerA,
    department: "SERVICE",
    status: "UNREAD",
    ...overrides,
  };
}

describe("notificationScopeWhere", () => {
  it("gives an advisor the alerts addressed to her", () => {
    assert.equal(
      matches(notificationScopeWhere(serviceAdvisor), alertRow({ recipientUserId: serviceAdvisor.id, department: "PARTS" })),
      true,
    );
  });

  it("gives an advisor the alerts raised against her department, whoever they were addressed to", () => {
    assert.equal(matches(notificationScopeWhere(serviceAdvisor), alertRow({ department: "SERVICE" })), true);
  });

  it("keeps another department's alerts out of her rail", () => {
    assert.equal(matches(notificationScopeWhere(serviceAdvisor), alertRow({ department: "PARTS" })), false);
  });

  it("gives a manager the whole dealership", () => {
    assert.equal(matches(notificationScopeWhere(manager), alertRow({ department: "PARTS" })), true);
  });

  it("gives a reader with no department only her own alerts", () => {
    const scope = notificationScopeWhere(floater);

    assert.equal(matches(scope, alertRow({ recipientUserId: floater.id, department: null })), true);
    assert.equal(matches(scope, alertRow({ department: "SERVICE" })), false);
  });
});

describe("activeNotificationsWhere", () => {
  it("counts an alert that is still standing", () => {
    assert.equal(
      matches(activeNotificationsWhere(serviceAdvisor), alertRow({ department: "SERVICE", status: "UNREAD" })),
      true,
    );
  });

  it("leaves out an alert whose work is done", () => {
    assert.equal(
      matches(activeNotificationsWhere(serviceAdvisor), alertRow({ department: "SERVICE", status: "RESOLVED" })),
      false,
    );
  });

  it("keeps an alert she has already looked at, because looking is not doing", () => {
    assert.equal(
      matches(activeNotificationsWhere(serviceAdvisor), alertRow({ department: "SERVICE", status: "READ" })),
      true,
    );
  });

  it("still respects who may read it", () => {
    assert.equal(
      matches(activeNotificationsWhere(serviceAdvisor), alertRow({ department: "PARTS", status: "UNREAD" })),
      false,
    );
  });
});

// The defect this closes, seen on the running app before the fix: the badge
// read 5 and the rail listed 3, with no route to the other 2. The badge and
// the list were two different questions - one counted the unread rows, the
// other listed everything not resolved and then cut the list short - so they
// were free to describe different sets.
//
// This runs both paths over one set of rows: the badge counts facts through a
// database grouping, the rail dedupes the rows it read. They have to land on
// the same number, and everything counted has to be reachable.
describe("the badge counts exactly what the rail can show", () => {
  type StoredAlert = ReturnType<typeof alert>;

  /** What `countNotificationFacts` does: count the distinct fact keys, in the database. */
  function badgeCount(all: StoredAlert[]) {
    return new Set(all.map(notificationFactKey)).size;
  }

  /** What the rail does: read up to the scan limit, then collapse. */
  function railListed(all: StoredAlert[], scanLimit: number) {
    return dedupeNotificationFacts(all.slice(0, scanLimit), advisor).length;
  }

  const rows = [
    // One overdue follow-up, copied to two managers and its assignee.
    alert("FOLLOW_UP_OVERDUE", managerA, { taskId: "task-1", conversationId: "conv-1" }),
    alert("FOLLOW_UP_OVERDUE", managerB, { taskId: "task-1", conversationId: "conv-1" }),
    alert("FOLLOW_UP_OVERDUE", advisor, { taskId: "task-1", conversationId: "conv-1" }),
    // The "due today" row it superseded, still stored.
    alert("FOLLOW_UP_DUE", managerA, { taskId: "task-1", conversationId: "conv-1" }),
    // A failed text, copied to both managers.
    alert("MESSAGE_FAILED", managerA, { conversationId: "conv-2", messageId: "msg-1" }),
    alert("MESSAGE_FAILED", managerB, { conversationId: "conv-2", messageId: "msg-1" }),
    // An unowned thread.
    alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "conv-3" }),
  ];

  it("agrees with the rail on how many things are waiting", () => {
    assert.equal(badgeCount(rows), railListed(rows, rows.length));
  });

  it("counts three real facts out of seven stored rows", () => {
    assert.equal(badgeCount(rows), 3);
  });

  it("says how many are past the scan rather than dropping them silently", () => {
    // A scan short enough to miss the last fact: the rail lists what it read
    // and the difference against the badge is what the "more in Command
    // Center" row exists to carry.
    const scanned = railListed(rows, 6);

    assert.equal(scanned, 2);
    assert.equal(badgeCount(rows) - scanned, 1);
  });

  it("agrees with the rail on a thread that is stored once per text", () => {
    // Both sides ask the fact key: the database counts distinct values of it,
    // the rail collapses the rows it read by it. So the shapes that used to
    // read as several things to do - the two an unowned thread is written in,
    // and a row per text that landed on a busy thread - come to one fact
    // whichever side of the screen is asking.
    const perMessage = [
      alert("UNASSIGNED_CONVERSATION", managerA, { conversationId: "conv-4", messageId: "msg-2" }),
      alert("UNASSIGNED_CONVERSATION", managerB, { conversationId: "conv-4" }),
      ...["msg-3", "msg-4", "msg-5", "msg-6", "msg-7"].map((messageId) =>
        alert("NEW_INBOUND_MESSAGE", advisor, { conversationId: "conv-5", messageId }),
      ),
    ];

    assert.equal(badgeCount(perMessage), 2);
    assert.equal(badgeCount(perMessage), railListed(perMessage, perMessage.length));
  });

  it("asks one question, so an alert she has looked at is on both sides", () => {
    // The badge used to count only UNREAD while the list showed everything not
    // resolved. Nothing in the app marks an alert read, which is the only
    // reason that never showed up as a divergence on its own.
    const where = activeNotificationsWhere(serviceAdvisor);

    for (const status of ["UNREAD", "READ"]) {
      assert.equal(matches(where, alertRow({ department: "SERVICE", status })), true, status);
    }
  });
});

// The badge is a number the database works out, so the rule for what makes one
// fact now exists twice: as the key above, and as the expression SQL counts
// distinct values of. A badge and a list answering the same question
// differently is the whole defect, so the two are built from one pair of type
// lists and these hold them to it. Editing either rule without the other has
// to fail here.
describe("the counted key and the collapsed key are one rule", () => {
  const counted = notificationFactCountQuery(serviceAdvisor);

  it("counts by the very lists the key collapses by", () => {
    assert.ok(counted.values.includes(followUpTypes), "the SQL carries its own follow-up list");
    assert.ok(counted.values.includes(perMessageTypes), "the SQL carries its own per-message list");
    assert.ok(counted.values.includes(followUpSubject));
  });

  it("joins the same parts, in the same order, as the key", () => {
    const parts = notificationFactKey(
      alert("MESSAGE_FAILED", advisor, { conversationId: "c1", messageId: "m1" }),
    ).split(" ");

    assert.equal(counted.sql.split("|| ' ' ||").length - 1, parts.length - 1);
    assert.deepEqual(
      [...counted.sql.matchAll(/"(conversationId|taskId|messageId)"/g)].map((match) => match[1]),
      ["conversationId", "taskId", "messageId"],
    );
  });

  it("gives a follow-up's two states the one subject the key gives them", () => {
    for (const type of followUpTypes) {
      assert.equal(
        notificationFactKey(alert(type, advisor, { conversationId: "c1", taskId: "t1" })).split(" ")[0],
        followUpSubject,
      );
    }
  });
});

// The counted rows have to be the listed rows, so the scope and the status
// clause are the same decisions the rail's queries make.
describe("the badge counts over the rows the rail lists", () => {
  it("gives a manager the whole dealership", () => {
    assert.equal(notificationFactCountQuery(manager).sql.includes(`"recipientUserId"`), false);
  });

  it("gives an advisor her own alerts and her department's", () => {
    const counted = notificationFactCountQuery(serviceAdvisor);

    assert.ok(counted.sql.includes(`"recipientUserId" = `));
    assert.ok(counted.sql.includes(`"department"::text = `));
    assert.ok(counted.values.includes(serviceAdvisor.id));
    assert.ok(counted.values.includes(serviceAdvisor.department));
  });

  it("gives a reader with no department only her own", () => {
    const counted = notificationFactCountQuery(floater);

    assert.ok(counted.sql.includes(`"recipientUserId" = `));
    assert.equal(counted.sql.includes(`"department"::text = `), false);
  });

  it("leaves out the alerts whose work is done", () => {
    assert.ok(notificationFactCountQuery(serviceAdvisor).values.includes("RESOLVED"));
  });

  it("narrows to one type only when a tile asks for one", () => {
    assert.ok(notificationFactCountQuery(manager, "SLA_MISSED").values.includes("SLA_MISSED"));
    assert.equal(notificationFactCountQuery(manager).sql.includes(`"type"::text = ?`), false);
  });
});

// Opening a thread now clears its unread marker, which is also the moment to
// withdraw the alert that existed only to say a message had arrived. The
// dangerous version of that change is the one that keeps going and withdraws
// alerts about work she has read but not done, so the list is pinned here
// rather than left to a future edit.
describe("readResolvesNotificationTypes", () => {
  it("withdraws the alert whose whole job was to say a message arrived", () => {
    assert.ok(readResolvesNotificationTypes.includes(NotificationType.NEW_INBOUND_MESSAGE));
  });

  const stillUndoneAfterReading: Array<[NotificationType, string]> = [
    [NotificationType.SLA_MISSED, "the customer is still waiting for an answer"],
    [NotificationType.MESSAGE_FAILED, "the text still never reached the customer"],
    [NotificationType.UNASSIGNED_CONVERSATION, "the thread still has no owner"],
    [NotificationType.FOLLOW_UP_DUE, "the follow-up still has to be done today"],
    [NotificationType.FOLLOW_UP_OVERDUE, "the follow-up is still late"],
    [NotificationType.CONVERSATION_ASSIGNED, "the thread handed to her is still hers to work"],
    [NotificationType.CONVERSATION_REASSIGNED, "the thread handed to her is still hers to work"],
  ];

  for (const [type, reason] of stillUndoneAfterReading) {
    it(`keeps ${type} because ${reason}`, () => {
      assert.equal(readResolvesNotificationTypes.includes(type), false);
    });
  }

  it("covers every alert type, so a new one is a deliberate decision", () => {
    const decided = new Set<string>([
      ...readResolvesNotificationTypes,
      ...stillUndoneAfterReading.map(([type]) => type),
    ]);

    assert.deepEqual(
      Object.values(NotificationType).filter((type) => !decided.has(type)),
      [],
    );
  });
});
