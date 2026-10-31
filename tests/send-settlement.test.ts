import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEND_CLOCK_SKEW_MS,
  SEND_GRACE_MS,
  SEND_SETTLEMENT_MS,
  type Settlement,
  type TwilioMessage,
  type UnconfirmedSend,
  needsSettling,
  settleSend,
} from "../src/lib/send-settlement";

// A text stuck in SENDING holds its thread until something says whether it
// went. When Twilio's callback never came, this rule reads Twilio's list of
// messages to the number and decides. Calling a text Twilio holds FAILED
// invites "Rewrite it", which texts the customer twice; calling one it never
// got SENT tells her it was answered. So the rule is a table.

const SENT_AT = new Date("2026-10-31T15:00:00Z");
const after = (ms: number) => new Date(SENT_AT.getTime() + ms);
const send: UnconfirmedSend = { to: "+15553530001", body: "Yes, ready at 3.", createdAt: SENT_AT };

function twilioMessage(overrides: Partial<TwilioMessage> = {}): TwilioMessage {
  return {
    sid: "SMours",
    to: send.to,
    body: send.body,
    direction: "outbound-api",
    dateCreated: after(400),
    ...overrides,
  };
}

const PAST_GRACE = after(SEND_GRACE_MS);
const PAST_SETTLEMENT = after(SEND_SETTLEMENT_MS);
const BETWEEN = after(SEND_GRACE_MS + 10_000);
const none = new Set<string>();

describe("the bounds", () => {
  it("asks after 30 seconds and calls an absent text failed after two minutes", () => {
    assert.equal(SEND_GRACE_MS, 30_000);
    assert.equal(SEND_SETTLEMENT_MS, 120_000);
    assert.ok(SEND_SETTLEMENT_MS > SEND_GRACE_MS);
  });

  it("leaves a send younger than the grace period alone", () => {
    assert.equal(needsSettling(send, after(SEND_GRACE_MS - 1)), false);
    assert.equal(needsSettling(send, PAST_GRACE), true);
  });
});

describe("settleSend", () => {
  const table: Array<[string, TwilioMessage[], Set<string>, Date, Settlement]> = [
    ["Twilio has it", [twilioMessage()], none, PAST_GRACE, { status: "SENT", sid: "SMours" }],
    ["Twilio has it, after the settlement bound too", [twilioMessage()], none, PAST_SETTLEMENT, { status: "SENT", sid: "SMours" }],
    ["inside the grace period, even when Twilio has it", [twilioMessage()], none, after(1_000), { status: "WAIT" }],
    ["nothing at Twilio yet, before the bound", [], none, BETWEEN, { status: "WAIT" }],
    ["nothing at Twilio once the bound has passed", [], none, PAST_SETTLEMENT, { status: "FAILED" }],
    [
      "dated a little before the row, inside the clock skew",
      [twilioMessage({ dateCreated: after(-SEND_CLOCK_SKEW_MS) })],
      none,
      PAST_GRACE,
      { status: "SENT", sid: "SMours" },
    ],
    [
      "an older text with the same words, from before the row",
      [twilioMessage({ dateCreated: after(-SEND_CLOCK_SKEW_MS - 1) })],
      none,
      PAST_SETTLEMENT,
      { status: "FAILED" },
    ],
    [
      "a different body",
      [twilioMessage({ body: "Yes, ready at 4." })],
      none,
      PAST_SETTLEMENT,
      { status: "FAILED" },
    ],
    [
      "a different number",
      [twilioMessage({ to: "+15553530002" })],
      none,
      PAST_SETTLEMENT,
      { status: "FAILED" },
    ],
    [
      "the customer's own text with the same words",
      [twilioMessage({ direction: "inbound" })],
      none,
      PAST_SETTLEMENT,
      { status: "FAILED" },
    ],
    [
      "the same words sent on purpose a moment before, already held by that row",
      [twilioMessage({ sid: "SMearlier" })],
      new Set(["SMearlier"]),
      PAST_SETTLEMENT,
      { status: "FAILED" },
    ],
    [
      "the same words twice, one held: takes the other",
      [twilioMessage({ sid: "SMlater", dateCreated: after(5_000) }), twilioMessage({ sid: "SMearlier" })],
      new Set(["SMearlier"]),
      PAST_GRACE,
      { status: "SENT", sid: "SMlater" },
    ],
    [
      "the same words twice, neither held: takes the oldest",
      [twilioMessage({ sid: "SMlater", dateCreated: after(5_000) }), twilioMessage({ sid: "SMearlier" })],
      none,
      PAST_GRACE,
      { status: "SENT", sid: "SMearlier" },
    ],
  ];

  for (const [name, found, held, now, expected] of table) {
    it(`${name}: ${expected.status}`, () => {
      assert.deepEqual(settleSend(send, found, held, now), expected);
    });
  }
});
