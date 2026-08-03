import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Priority } from "../src/generated/prisma/client";
import {
  type RankableConversation,
  type RankableInsight,
  queueScore,
  rankConversationQueue,
} from "../src/lib/ai/queue-rank";

function insight(overrides: Partial<RankableInsight> = {}): RankableInsight {
  return {
    riskLevel: Priority.NORMAL,
    escalationRecommended: false,
    dismissedAt: null,
    ...overrides,
  };
}

function conversation(overrides: Partial<RankableConversation> = {}): RankableConversation {
  return {
    unread: false,
    priority: Priority.NORMAL,
    lastMessageAt: new Date("2026-08-02T09:00:00.000Z"),
    aiInsights: [],
    ...overrides,
  };
}

describe("queueScore", () => {
  it("scores an unbriefed conversation as NORMAL, because an unknown is not a safe bet", () => {
    const unbriefed = queueScore(conversation({ aiInsights: [] }));

    assert.equal(unbriefed, queueScore(conversation({ aiInsights: [insight({ riskLevel: Priority.NORMAL })] })));
    assert.ok(unbriefed > queueScore(conversation({ aiInsights: [insight({ riskLevel: Priority.LOW })] })));
    assert.ok(unbriefed < queueScore(conversation({ aiInsights: [insight({ riskLevel: Priority.HIGH })] })));
  });

  it("orders risk levels", () => {
    const score = (riskLevel: Priority) => queueScore(conversation({ aiInsights: [insight({ riskLevel })] }));

    assert.ok(score(Priority.URGENT) > score(Priority.HIGH));
    assert.ok(score(Priority.HIGH) > score(Priority.NORMAL));
    assert.ok(score(Priority.NORMAL) > score(Priority.LOW));
  });

  it("puts any escalated brief above any non-escalated one", () => {
    const escalatedButLow = queueScore(
      conversation({ aiInsights: [insight({ riskLevel: Priority.LOW, escalationRecommended: true })] }),
    );
    const urgentNotEscalated = queueScore(
      conversation({ aiInsights: [insight({ riskLevel: Priority.URGENT })] }),
    );

    assert.ok(escalatedButLow > urgentNotEscalated);
  });

  it("falls back to the staff priority when a brief is dismissed, so the human signal survives", () => {
    const dismissedUrgentThread = conversation({
      priority: Priority.URGENT,
      aiInsights: [insight({ riskLevel: Priority.LOW, dismissedAt: new Date("2026-08-02T10:00:00.000Z") })],
    });

    assert.equal(
      queueScore(dismissedUrgentThread),
      queueScore(conversation({ aiInsights: [insight({ riskLevel: Priority.URGENT })] })),
    );
  });

  it("does not let a dismissed brief bury an urgent thread below an unbriefed one", () => {
    const dismissedUrgent = conversation({
      priority: Priority.URGENT,
      aiInsights: [insight({ riskLevel: Priority.URGENT, dismissedAt: new Date("2026-08-02T10:00:00.000Z") })],
    });

    assert.ok(queueScore(dismissedUrgent) > queueScore(conversation({ aiInsights: [] })));
  });

  it("ignores escalation on a dismissed brief", () => {
    const dismissedEscalated = conversation({
      priority: Priority.LOW,
      aiInsights: [
        insight({
          riskLevel: Priority.URGENT,
          escalationRecommended: true,
          dismissedAt: new Date("2026-08-02T10:00:00.000Z"),
        }),
      ],
    });

    assert.equal(
      queueScore(dismissedEscalated),
      queueScore(conversation({ priority: Priority.LOW, aiInsights: [insight({ riskLevel: Priority.LOW })] })),
    );
  });

  it("reads only the newest insight", () => {
    const scored = conversation({
      aiInsights: [insight({ riskLevel: Priority.URGENT }), insight({ riskLevel: Priority.LOW })],
    });

    assert.equal(scored.aiInsights.length, 2);
    assert.equal(queueScore(scored), queueScore(conversation({ aiInsights: [insight({ riskLevel: Priority.URGENT })] })));
  });
});

describe("rankConversationQueue", () => {
  it("orders by score before anything else", () => {
    const low = { ...conversation({ aiInsights: [insight({ riskLevel: Priority.LOW })] }), id: "low" };
    const urgent = { ...conversation({ aiInsights: [insight({ riskLevel: Priority.URGENT })] }), id: "urgent" };

    assert.deepEqual(
      rankConversationQueue([low, urgent]).map((entry) => entry.id),
      ["urgent", "low"],
    );
  });

  it("breaks a score tie by unread first", () => {
    const read = { ...conversation({ unread: false }), id: "read" };
    const unread = { ...conversation({ unread: true }), id: "unread" };

    assert.deepEqual(
      rankConversationQueue([read, unread]).map((entry) => entry.id),
      ["unread", "read"],
    );
  });

  it("breaks a score and unread tie by most recent activity", () => {
    const older = {
      ...conversation({ lastMessageAt: new Date("2026-08-01T09:00:00.000Z") }),
      id: "older",
    };
    const newer = {
      ...conversation({ lastMessageAt: new Date("2026-08-02T09:00:00.000Z") }),
      id: "newer",
    };

    assert.deepEqual(
      rankConversationQueue([older, newer]).map((entry) => entry.id),
      ["newer", "older"],
    );
  });

  it("keeps score ahead of recency, so a fresh quiet thread cannot outrank an urgent stale one", () => {
    const freshLow = {
      ...conversation({
        unread: true,
        lastMessageAt: new Date("2026-08-02T11:00:00.000Z"),
        aiInsights: [insight({ riskLevel: Priority.LOW })],
      }),
      id: "fresh-low",
    };
    const staleUrgent = {
      ...conversation({
        unread: false,
        lastMessageAt: new Date("2026-07-30T08:00:00.000Z"),
        aiInsights: [insight({ riskLevel: Priority.URGENT, escalationRecommended: true })],
      }),
      id: "stale-urgent",
    };

    assert.deepEqual(
      rankConversationQueue([freshLow, staleUrgent]).map((entry) => entry.id),
      ["stale-urgent", "fresh-low"],
    );
  });

  it("does not mutate or reorder its input", () => {
    const low = { ...conversation({ aiInsights: [insight({ riskLevel: Priority.LOW })] }), id: "low" };
    const urgent = { ...conversation({ aiInsights: [insight({ riskLevel: Priority.URGENT })] }), id: "urgent" };
    const input = [low, urgent];

    const ranked = rankConversationQueue(input);

    assert.notEqual(ranked, input);
    assert.deepEqual(input.map((entry) => entry.id), ["low", "urgent"]);
  });

  it("returns an empty array unchanged", () => {
    assert.deepEqual(rankConversationQueue([]), []);
  });
});
