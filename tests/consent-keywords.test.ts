import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ConsentKeyword, classifyConsentReply } from "../src/lib/consent";

// 47 CFR 64.1200(a)(10) names stop, quit, end, revoke, opt out, cancel and
// unsubscribe as per se revocations of consent to texts. The webhook matched
// only six single words, exactly and with punctuation intact, so "REVOKE",
// "OPT OUT" and "Stop." all fell through. The CTIA says a de minimis variance
// in case or punctuation must not defeat an opt-out; nothing else in a longer
// text revokes on its own, it asks a person (decision 3).

const cases: Array<[string, ConsentKeyword]> = [
  ["STOP", "REVOKE"],
  ["stop", "REVOKE"],
  [" Stop. ", "REVOKE"],
  ["STOP!!", "REVOKE"],
  ["OPT OUT", "REVOKE"],
  ["opt-out", "REVOKE"],
  ["Opt  out", "REVOKE"],
  ["optout", "REVOKE"],
  ["REVOKE", "REVOKE"],
  ["unsubscribe", "REVOKE"],
  ["StopAll", "REVOKE"],
  ["cancel", "REVOKE"],
  ["End", "REVOKE"],
  ["quit.", "REVOKE"],
  ["unstop", "GRANT"],
  ["start", "GRANT"],
  ["START.", "GRANT"],
  ["yes", "YES"],
  ["Yes!", "YES"],
  // Possible stop requests in other words: a person decides.
  ["stop please", "REVIEW"],
  ["STOP PLEASE", "REVIEW"],
  ["Please stop texting me", "REVIEW"],
  ["please don't stop working on the carb", "REVIEW"],
  ["don’t text this number", "REVIEW"],
  ["Do not text me again", "REVIEW"],
  ["dont text", "REVIEW"],
  ["remove me from your list", "REVIEW"],
  ["Wrong number", "REVIEW"],
  ["I want to opt out of these", "REVIEW"],
  ["unsubscribe me", "REVIEW"],
  // Ordinary business, which must not block a thread.
  ["yesterday", "NONE"],
  ["I stopped by yesterday", "NONE"],
  ["the nonstop rattle is back", "NONE"],
  ["can I cancel my appointment?", "NONE"],
  ["pick it up at the end of the day", "NONE"],
  ["yes please", "NONE"],
  ["start the work whenever you're ready", "NONE"],
  ["", "NONE"],
];

describe("classifyConsentReply", () => {
  for (const [body, expected] of cases) {
    it(`${JSON.stringify(body)} is ${expected}`, () => {
      assert.equal(classifyConsentReply(body), expected);
    });
  }
});
