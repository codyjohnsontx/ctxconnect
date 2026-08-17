import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SMS_BODY_LIMIT, smsOverBy, smsTooLongMessage } from "../src/lib/sms-length";

describe("smsOverBy", () => {
  it("is zero for a reply that fits", () => {
    assert.equal(smsOverBy(""), 0);
    assert.equal(smsOverBy("Your bike is ready."), 0);
    assert.equal(smsOverBy("A".repeat(SMS_BODY_LIMIT)), 0);
  });

  // The defect this covers: a 1740-character reply was accepted by the box, Send
  // stayed enabled, and the only refusal came back from the route as "Invalid
  // message payload." - indistinguishable from the software being broken.
  it("reports how far over the limit a long reply is", () => {
    assert.equal(smsOverBy("A".repeat(SMS_BODY_LIMIT + 1)), 1);
    assert.equal(smsOverBy("A".repeat(1740)), 140);
  });

  // The send route trims before it measures, so the box has to trim too or it
  // refuses a reply the route would have accepted.
  it("measures the reply the way the route stores it, trimmed", () => {
    assert.equal(smsOverBy(`  ${"A".repeat(SMS_BODY_LIMIT)}  \n`), 0);
    assert.equal(smsOverBy(`\n\n${"A".repeat(SMS_BODY_LIMIT + 5)}\t`), 5);
  });
});

describe("smsTooLongMessage", () => {
  it("names how much to cut and where the line is", () => {
    const text = smsTooLongMessage(140);

    assert.match(text, /140 characters too long/);
    assert.match(text, new RegExp(`${SMS_BODY_LIMIT} characters or fewer`));
  });

  it("reads correctly when it is over by one", () => {
    assert.match(smsTooLongMessage(1), /1 character too long/);
  });

  // The advisor cannot act on how many texts the carrier will bill for, so the
  // refusal must not turn into a lesson about SMS segments.
  it("says nothing about segments, encodings, or texts sent", () => {
    const text = smsTooLongMessage(140);

    assert.doesNotMatch(text, /segment|GSM|unicode|separate texts/i);
  });
});
