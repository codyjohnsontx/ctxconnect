import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRAFT_MAX_AGE_MS,
  draftStorageKey,
  isDraftKeyFor,
  parseDraft,
  serializeDraft,
} from "../src/lib/drafts";

const NOW = Date.UTC(2026, 7, 12, 17, 0, 0);

function stored(body: string, blanks: string[] = [], savedAt = NOW) {
  return serializeDraft({ body, blanks }, savedAt);
}

describe("draftStorageKey", () => {
  it("keeps one advisor's draft off another advisor's screen", () => {
    // A dealership front desk is one shared browser. Two people signing in
    // and out of the same machine must never see each other's words.
    assert.notEqual(draftStorageKey("alyssa", "conv-1"), draftStorageKey("cody", "conv-1"));
  });

  it("keeps one conversation's draft out of another conversation", () => {
    assert.notEqual(draftStorageKey("alyssa", "conv-1"), draftStorageKey("alyssa", "conv-2"));
  });

  it("gives the same conversation the same key every time", () => {
    assert.equal(draftStorageKey("alyssa", "conv-1"), draftStorageKey("alyssa", "conv-1"));
  });
});

describe("serializeDraft", () => {
  it("stores nothing for an empty box", () => {
    assert.equal(stored(""), null);
  });

  it("stores nothing for a box holding only whitespace", () => {
    // Otherwise she comes back to "you left a draft here" over a blank box.
    assert.equal(stored("   \n\t "), null);
  });

  it("keeps the body exactly as typed, whitespace and all", () => {
    const draft = parseDraft(stored("Ruben,\n\n  the tech is on it. "), NOW);
    assert.equal(draft?.body, "Ruben,\n\n  the tech is on it. ");
  });

  it("keeps the blanks a template left behind", () => {
    const draft = parseDraft(stored("Ready at [pickup time].", ["[pickup time]"]), NOW);
    assert.deepEqual(draft?.blanks, ["[pickup time]"]);
  });

  it("drops empty blanks rather than storing them", () => {
    const draft = parseDraft(stored("Hi", ["", "[unit]"]), NOW);
    assert.deepEqual(draft?.blanks, ["[unit]"]);
  });
});

describe("parseDraft", () => {
  it("has no draft when nothing was ever stored", () => {
    assert.equal(parseDraft(null, NOW), null);
    assert.equal(parseDraft(undefined, NOW), null);
    assert.equal(parseDraft("", NOW), null);
  });

  it("treats an unreadable entry as no draft rather than an error", () => {
    // A corrupt entry must never be able to stop her from typing a reply.
    assert.equal(parseDraft("{not json", NOW), null);
    assert.equal(parseDraft("null", NOW), null);
    assert.equal(parseDraft('"a string"', NOW), null);
    assert.equal(parseDraft("[]", NOW), null);
  });

  it("treats an entry with no body as no draft", () => {
    assert.equal(parseDraft(JSON.stringify({ blanks: [], savedAt: NOW }), NOW), null);
    assert.equal(parseDraft(JSON.stringify({ body: "  ", blanks: [], savedAt: NOW }), NOW), null);
  });

  it("treats an entry with no usable timestamp as no draft", () => {
    assert.equal(parseDraft(JSON.stringify({ body: "Hi", blanks: [] }), NOW), null);
    assert.equal(parseDraft(JSON.stringify({ body: "Hi", blanks: [], savedAt: "today" }), NOW), null);
  });

  it("survives an entry whose blanks are the wrong shape", () => {
    const draft = parseDraft(JSON.stringify({ body: "Hi", blanks: "nope", savedAt: NOW }), NOW);
    assert.deepEqual(draft, { body: "Hi", blanks: [] });
  });

  it("puts back a draft written moments ago", () => {
    assert.equal(parseDraft(stored("Hi Ruben"), NOW + 1000)?.body, "Hi Ruben");
  });

  it("puts back a draft written before a long lunch", () => {
    const beforeLunch = NOW - 2 * 60 * 60 * 1000;
    assert.equal(parseDraft(stored("Hi Ruben", [], beforeLunch), NOW)?.body, "Hi Ruben");
  });

  it("does not put back a draft the thread has moved on from", () => {
    // Text older than the shift that wrote it is likelier to mislead her than
    // help, and she has no way to tell how old the words in the box are.
    const stale = NOW - DRAFT_MAX_AGE_MS - 1;
    assert.equal(parseDraft(stored("Hi Ruben", [], stale), NOW), null);
  });

  it("keeps a draft right up to the age limit", () => {
    const edge = NOW - DRAFT_MAX_AGE_MS;
    assert.equal(parseDraft(stored("Hi Ruben", [], edge), NOW)?.body, "Hi Ruben");
  });

  it("round-trips a draft that still holds a template blank", () => {
    // This is the pairing that matters: losing the blanks on the way back
    // would re-enable Send on a reply that still says [pickup time].
    const raw = stored("Your bike is ready at [pickup time].", ["[pickup time]"]);
    assert.deepEqual(parseDraft(raw, NOW), {
      body: "Your bike is ready at [pickup time].",
      blanks: ["[pickup time]"],
    });
  });
});

// A draft is unsent, customer-facing text that names the customer and their
// unit. Keying by user stops the next person on a shared front-desk browser
// reading it in the app; sign-out has to take it off the machine as well, and
// it must take only hers.
describe("the drafts sign-out clears", () => {
  it("claims this advisor's drafts", () => {
    assert.equal(isDraftKeyFor(draftStorageKey("alyssa", "conv-1"), "alyssa"), true);
    assert.equal(isDraftKeyFor(draftStorageKey("alyssa", "conv-2"), "alyssa"), true);
  });

  it("leaves another advisor's drafts alone", () => {
    assert.equal(isDraftKeyFor(draftStorageKey("cody", "conv-1"), "alyssa"), false);
  });

  it("leaves everything else in storage alone", () => {
    assert.equal(isDraftKeyFor("ctx-theme", "alyssa"), false);
    assert.equal(isDraftKeyFor("attend:draft:v1", "alyssa"), false);
  });

  // "alyssa" must not claim "alyssa-2"'s drafts, which a bare prefix would do.
  it("does not claim the drafts of a user whose id starts the same way", () => {
    assert.equal(isDraftKeyFor(draftStorageKey("alyssa-2", "conv-1"), "alyssa"), false);
  });
});

// A week of unsent customer text on a shared machine outlives the shift that
// wrote it. Long enough to survive lunch or a browser restart, short enough to
// be gone before the next day opens.
describe("a draft does not outlive the shift", () => {
  it("keeps a draft written earlier in the same day", () => {
    const eightHoursAgo = NOW - 8 * 60 * 60 * 1000;
    assert.notEqual(parseDraft(stored("Still on it", [], eightHoursAgo), NOW), null);
  });

  it("does not put back a draft left overnight", () => {
    const yesterday = NOW - 16 * 60 * 60 * 1000;
    assert.equal(parseDraft(stored("Left last night", [], yesterday), NOW), null);
  });
});
