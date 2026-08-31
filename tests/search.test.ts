import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsTerm,
  conversationQueryWhere,
  conversationSearchWhere,
  escapeLikeWildcards,
  matchSnippet,
  normalizeSearchTerm,
  searchPhoneDigits,
} from "../src/lib/search";
import { Department } from "../src/generated/prisma/enums";
import type { Prisma } from "../src/generated/prisma/client";

describe("normalizeSearchTerm", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(normalizeSearchTerm("  renee   whitlock "), "renee whitlock");
  });

  it("treats nothing typed as nothing searched", () => {
    assert.equal(normalizeSearchTerm(undefined), "");
    assert.equal(normalizeSearchTerm(null), "");
    assert.equal(normalizeSearchTerm("   "), "");
  });
});

describe("searchPhoneDigits", () => {
  it("reads a number through whatever punctuation she typed", () => {
    assert.equal(searchPhoneDigits("(512) 555-0110"), "5125550110");
    assert.equal(searchPhoneDigits("512.555.0110"), "5125550110");
    assert.equal(searchPhoneDigits("+1 512 555 0110"), "15125550110");
  });

  it("accepts the last few digits off a caller ID", () => {
    assert.equal(searchPhoneDigits("0110"), "0110");
  });

  it("ignores one or two stray digits, which are noise rather than a number", () => {
    assert.equal(searchPhoneDigits("R 12"), null);
    assert.equal(searchPhoneDigits("renee"), null);
  });
});

describe("conversationSearchWhere", () => {
  it("leaves the queue alone when nothing was typed", () => {
    assert.equal(conversationSearchWhere(""), null);
    assert.equal(conversationSearchWhere("   "), null);
  });

  it("looks at the customer name and the message text, case-insensitively", () => {
    const where = conversationSearchWhere("Warranty");

    assert.deepEqual(where?.OR, [
      { customer: { name: { contains: "Warranty", mode: "insensitive" } } },
      { messages: { some: { body: { contains: "Warranty", mode: "insensitive" } } } },
    ]);
  });

  it("adds the phone clause on digits only, matched against stored E.164", () => {
    const where = conversationSearchWhere("(512) 555-0110");

    assert.deepEqual(where?.OR?.at(-1), { customer: { phone: { contains: "5125550110" } } });
    // The stored form is +15125550110, so the digits alone have to be a
    // substring of it or a formatted number would never find its own customer.
    assert.ok("+15125550110".includes("5125550110"));
  });

  it("does not search phones for a name", () => {
    assert.equal(conversationSearchWhere("Renee")?.OR?.length, 2);
  });

  // Reproduced while driving the box: typing a bare % returned the whole queue,
  // which reads as a search that ignored her rather than one that found nothing.
  it("searches for a typed % or _ literally instead of as a wildcard", () => {
    const where = conversationSearchWhere("15% off");
    const nameClause = where?.OR?.[0] as { customer: { name: { contains: string } } };

    assert.equal(nameClause.customer.name.contains, "15\\% off");
    assert.equal(escapeLikeWildcards("RO_48244"), "RO\\_48244");
    // Backslash is Postgres's own LIKE escape character, so it has to escape
    // itself or it would consume the character after it.
    assert.equal(escapeLikeWildcards("back\\slash"), "back\\\\slash");
    assert.equal(escapeLikeWildcards("%"), "\\%");
  });

  it("carries the wildcards through the phone clause as digits, not as a pattern", () => {
    // Digits are extracted from the raw term, so punctuation - wildcards
    // included - never reaches the phone comparison at all.
    const where = conversationSearchWhere("512%555");

    assert.deepEqual(where?.OR?.at(-1), { customer: { phone: { contains: "512555" } } });
  });
});

// The search narrows the queue; it must never widen it. The queue's scope
// clause is what decides which threads this reader may open at all, and the
// filters own a top-level OR of their own - `needsAction` - so a search folded
// in beside that OR would reach past both.
describe("conversationQueryWhere", () => {
  const scope: Prisma.ConversationWhereInput = {
    OR: [{ assignedUserId: "advisor-1" }, { department: Department.SERVICE }],
  };

  function andParts(where: Prisma.ConversationWhereInput) {
    assert.ok(Array.isArray(where.AND), "the queue's where-clause is not an AND of clauses");

    return where.AND as Prisma.ConversationWhereInput[];
  }

  it("ANDs the reader's scope, her filters and her search", () => {
    const parts = andParts(conversationQueryWhere(scope, { unread: true }, "warranty"));

    assert.equal(parts.length, 3);
    assert.deepEqual(parts[0], scope);
    assert.deepEqual(parts[1], { unread: true });
    assert.deepEqual(parts[2], conversationSearchWhere("warranty"));
  });

  it("leaves the search out entirely when nothing was typed", () => {
    for (const term of [undefined, null, "", "   "]) {
      assert.deepEqual(conversationQueryWhere(scope, { unread: true }, term), {
        AND: [scope, { unread: true }],
      });
    }
  });

  it("keeps the reader's scope at the top level for every kind of term", () => {
    for (const term of ["warranty", "512-555-0110", "%", "_", "Renee Whitlock"]) {
      const where = conversationQueryWhere(scope, {}, term);

      assert.deepEqual(andParts(where)[0], scope, `scope was lost searching for ${term}`);
      assert.equal("OR" in where, false, `${term} put an OR beside the scope`);
    }
  });

  // The filters' own OR belongs to `needsAction`. A search merged into the same
  // object would replace it or join it; either way the queue widens.
  it("does not merge the search into the filters' own OR", () => {
    const needsAction: Prisma.ConversationWhereInput = {
      OR: [{ unread: true }, { assignedUserId: null }],
    };
    const parts = andParts(conversationQueryWhere(scope, needsAction, "warranty"));

    assert.deepEqual(parts[1], needsAction);
    assert.notDeepEqual(parts[1], parts[2]);
  });
});

describe("matchSnippet", () => {
  it("centers the excerpt on the match and marks both cuts", () => {
    const body = `${"a".repeat(200)} warranty claim ${"b".repeat(200)}`;
    const snippet = matchSnippet(body, "warranty");

    assert.ok(snippet.includes("warranty claim"));
    assert.ok(snippet.startsWith("…"));
    assert.ok(snippet.endsWith("…"));
    assert.ok(snippet.length < body.length);
  });

  it("matches regardless of case", () => {
    assert.ok(matchSnippet("Warranty claim submitted 9 days ago", "warranty").includes("Warranty"));
  });

  it("leaves a short message whole", () => {
    const body = "Warranty claim submitted 9 days ago.";

    assert.equal(matchSnippet(body, "warranty"), body);
  });

  it("falls back to the head of the message when the term is not in it", () => {
    const body = "c".repeat(300);

    assert.ok(matchSnippet(body, "warranty").endsWith("…"));
  });
});

describe("containsTerm", () => {
  it("decides whether the row preview already shows why the row matched", () => {
    assert.ok(containsTerm("Warranty claim submitted", "warranty"));
    assert.ok(!containsTerm("Bike is ready for pickup", "warranty"));
    assert.ok(!containsTerm("Bike is ready for pickup", "  "));
  });
});
