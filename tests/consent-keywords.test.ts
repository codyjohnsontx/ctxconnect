import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyConsentReply } from "../src/lib/consent";
import { consentReplyCases as cases } from "./consent-reply-cases";

// 47 CFR 64.1200(a)(10) names stop, quit, end, revoke, opt out, cancel and
// unsubscribe as per se revocations of consent to texts. The webhook matched
// only six single words, exactly and with punctuation intact, so "REVOKE",
// "OPT OUT" and "Stop." all fell through. The CTIA says a de minimis variance
// in case or punctuation must not defeat an opt-out; nothing else in a longer
// text revokes on its own, it asks a person (decision 3).

describe("classifyConsentReply", () => {
  for (const [body, expected] of cases) {
    it(`${JSON.stringify(body)} is ${expected}`, () => {
      assert.equal(classifyConsentReply(body), expected);
    });
  }
});
