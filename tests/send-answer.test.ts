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
      sendOutcome({ ok: false, payload: { error: "Twilio did not answer.", deliveryUnknown: true } }),
      { error: { message: "Twilio did not answer.", deliveryUnknown: true }, clearDraft: true },
    );
  });

  it("keeps the draft when the route refused the send", () => {
    assert.deepEqual(sendOutcome({ ok: false, payload: { error: "Texting is blocked for this customer." } }), {
      error: { message: "Texting is blocked for this customer.", deliveryUnknown: false },
      clearDraft: false,
    });
  });

  it("does not claim the text failed when the route gave no reason", () => {
    assert.deepEqual(sendOutcome({ ok: false, payload: null }), {
      error: { message: UNCONFIRMED_SEND, deliveryUnknown: false },
      clearDraft: false,
    });
  });

  it("clears the draft and the error once the text is sent", () => {
    assert.deepEqual(sendOutcome({ ok: true, payload: null }), { error: null, clearDraft: true });
  });
});
