import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNCONFIRMED_SEND, sendOutcome } from "../src/lib/send-answer";

describe("sendOutcome", () => {
  // The request reached the route, Twilio sent the text, and the connection
  // dropped before the answer came back. Leaving the draft in the box made the
  // identical text one press away from reaching the customer twice.
  it("clears the draft and claims nothing when the request never came back", () => {
    assert.deepEqual(sendOutcome(null), {
      error: { message: UNCONFIRMED_SEND, deliveryUnknown: true },
      clearDraft: true,
    });
  });

  it("clears the draft when the route says delivery is unknown", () => {
    assert.deepEqual(
      sendOutcome({ ok: false, status: 500, payload: { error: "Twilio did not answer.", deliveryUnknown: true } }),
      { error: { message: "Twilio did not answer.", deliveryUnknown: true }, clearDraft: true },
    );
  });

  it("keeps the draft when the route refused the send", () => {
    assert.deepEqual(sendOutcome({ ok: false, status: 403, payload: { error: "Texting is blocked for this customer." } }), {
      error: { message: "Texting is blocked for this customer.", deliveryUnknown: false },
      clearDraft: false,
    });
  });

  // The route can be cut off after Twilio took the text - a function timeout
  // or crash - and what answers then is the platform's page, not the route's
  // JSON. Keeping the draft made the same text one press from a second send.
  for (const status of [500, 502, 503, 504]) {
    it(`clears the draft and claims nothing when a ${status} comes back with a body the route did not write`, () => {
      assert.deepEqual(sendOutcome({ ok: false, status, payload: null }), {
        error: { message: UNCONFIRMED_SEND, deliveryUnknown: true },
        clearDraft: true,
      });
    });
  }

  for (const status of [400, 401, 403, 404, 413]) {
    it(`keeps the draft when a ${status} comes back with a body the route did not write, because nothing was sent`, () => {
      assert.deepEqual(sendOutcome({ ok: false, status, payload: null }), {
        error: { message: UNCONFIRMED_SEND, deliveryUnknown: false },
        clearDraft: false,
      });
    });
  }

  it("keeps the draft when the route itself explains a 5xx that sent nothing", () => {
    assert.deepEqual(sendOutcome({ ok: false, status: 503, payload: { error: "Texting is not connected." } }), {
      error: { message: "Texting is not connected.", deliveryUnknown: false },
      clearDraft: false,
    });
  });

  it("clears the draft and the error once the text is sent", () => {
    assert.deepEqual(sendOutcome({ ok: true, status: 200, payload: null }), { error: null, clearDraft: true });
  });
});
