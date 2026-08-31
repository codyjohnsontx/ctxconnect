import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { INBOX_FILTER_KEYS, clearFiltersHref, clearSearchHref, countActiveFilters } from "../src/lib/inbox-filters";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("INBOX_FILTER_KEYS", () => {
  it("names every key the queue query narrows on", () => {
    // The compiler already pins the list to `InboxFilters`; this pins
    // `InboxFilters` to the query, which reads the filters one `filters.<key>`
    // at a time. A filter the query honours but nothing counts is a queue that
    // is shorter than anything on screen explains - which is how `priority`,
    // reachable only by hand-typing a URL, went uncounted.
    const source = readFileSync(join(repoRoot, "src", "lib", "data.ts"), "utf8");
    const read = [...source.matchAll(/\bfilters\.(\w+)/g)].map((match) => match[1]);

    assert.deepEqual(
      // `q` narrows the queue too, but it is the search box rather than one of
      // these controls: it has its own label, its own way out, and clearing the
      // filters must not take it with them.
      [...new Set(read)].filter((key) => key !== "q").sort(),
      [...INBOX_FILTER_KEYS].sort(),
    );
  });
});

describe("countActiveFilters", () => {
  it("is zero on an unfiltered queue", () => {
    assert.equal(countActiveFilters({}), 0);
  });

  it("counts each filter that is narrowing the queue", () => {
    assert.equal(countActiveFilters({ department: "SERVICE" }), 1);
    assert.equal(countActiveFilters({ department: "SERVICE", unread: "true", tag: "t1" }), 3);
  });

  it("counts a filter that has no control in the form", () => {
    // `priority` narrows the query and can only arrive on the URL. Left
    // uncounted, it would shorten the queue with nothing on screen to explain
    // it and no way out.
    assert.equal(countActiveFilters({ priority: "URGENT" }), 1);
  });

  it("ignores an empty value, which is what `All departments` submits", () => {
    assert.equal(countActiveFilters({ department: "", status: "" }), 0);
  });

  it("ignores query keys that describe a navigation rather than a filter", () => {
    // `from` draws the back link; the hand-off pair reports one save. None of
    // them removes a row from the queue.
    assert.equal(countActiveFilters({ from: "tasks", movedTo: "PARTS", handOff: "department" }), 0);
  });
});

describe("clearFiltersHref", () => {
  it("drops every filter", () => {
    assert.equal(
      clearFiltersHref({ department: "SERVICE", unread: "true", priority: "URGENT" }),
      "/inbox",
    );
  });

  it("keeps the conversation she is reading open", () => {
    // Clearing filters from inside a thread must widen the list beside it, not
    // close the thread and send her back to hunt for it.
    assert.equal(clearFiltersHref({ status: "OPEN" }, "conv-1"), "/inbox/conv-1");
  });

  it("keeps the origin that drew her back link", () => {
    assert.equal(
      clearFiltersHref({ from: "tasks", status: "OPEN" }, "conv-1"),
      "/inbox/conv-1?from=tasks",
    );
  });

  it("escapes an origin arriving from the URL rather than pasting it in", () => {
    assert.equal(clearFiltersHref({ from: "a&b=c" }), "/inbox?from=a%26b%3Dc");
  });

  it("leaves a one-save notice behind", () => {
    // The hand-off banner reports the save that has just happened. Carrying it
    // through a clear would re-assert it on a page she has moved on from.
    assert.equal(clearFiltersHref({ movedTo: "PARTS", handOff: "assignment" }), "/inbox");
  });

  it("keeps the search those filters were narrowing", () => {
    // The link says Clear filters. Dropping the term as well would throw away
    // the customer she is on the phone about.
    assert.equal(clearFiltersHref({ q: "renee", status: "OPEN" }), "/inbox?q=renee");
  });
});

describe("clearSearchHref", () => {
  it("drops only the term", () => {
    assert.equal(
      clearSearchHref({ q: "renee", department: "SERVICE", unread: "true" }),
      "/inbox?department=SERVICE&unread=true",
    );
  });

  it("keeps a filter that has no control in the form", () => {
    // Same reason it is counted: leaving the search must not silently widen the
    // queue past a constraint that is still in effect.
    assert.equal(clearSearchHref({ q: "renee", priority: "URGENT" }), "/inbox?priority=URGENT");
  });

  it("keeps the conversation she is reading open, and her back link", () => {
    assert.equal(
      clearSearchHref({ q: "renee", from: "tasks" }, "conv-1"),
      "/inbox/conv-1?from=tasks",
    );
  });

  it("leaves a one-save notice behind", () => {
    assert.equal(clearSearchHref({ q: "renee", movedTo: "PARTS", handOff: "assignment" }), "/inbox");
  });
});
