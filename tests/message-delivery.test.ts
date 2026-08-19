import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeliveryStatus, MessageDirection } from "../src/generated/prisma/client";
import {
  TEXTING_NOT_CONNECTED,
  UNDELIVERED_HEADLINE,
  hasUndeliveredReply,
  isUndelivered,
  lastUndeliveredOutbound,
  newestReply,
  undeliveredDetail,
} from "../src/lib/message-delivery";

const { DELIVERED, FAILED, INTERNAL: INTERNAL_STATUS, QUEUED, RECEIVED, SENT } = DeliveryStatus;
const { INBOUND, INTERNAL, OUTBOUND } = MessageDirection;

type Message = { direction: MessageDirection; deliveryStatus: DeliveryStatus; body: string };

function message(direction: MessageDirection, deliveryStatus: DeliveryStatus, body = ""): Message {
  return { direction, deliveryStatus, body };
}

describe("isUndelivered", () => {
  // The defect this covers: a FAILED outbound reply rendered in the same bubble
  // as a delivered one, so the advisor read her own unsent text as an answer
  // already given and followed up as though the customer owed her a reply.
  it("is true for a staff reply the customer never received", () => {
    assert.equal(isUndelivered(message(OUTBOUND, FAILED)), true);
  });

  it("is false for a reply that went out", () => {
    for (const status of [QUEUED, SENT, DELIVERED]) {
      assert.equal(isUndelivered(message(OUTBOUND, status)), false, status);
    }
  });

  // A failed inbound is a delivery record on the customer's side, not a reply
  // the advisor owes anyone, so it must not wear the advisor's warning.
  it("is false for anything the advisor did not send to the customer", () => {
    assert.equal(isUndelivered(message(INBOUND, FAILED)), false);
    assert.equal(isUndelivered(message(INTERNAL, FAILED)), false);
  });
});

// The seeded Marco Silva thread, which is where this went wrong on screen: a
// reply the carrier rejected, and an internal note written an hour later.
const supersededFailure = [
  message(INBOUND, RECEIVED, "Did the Pirelli tires for my Tuareg arrive yet?"),
  message(OUTBOUND, FAILED, "Front arrived this morning. Rear is still showing tomorrow."),
  message(INTERNAL, INTERNAL_STATUS, "Rear tire ETA slipped from supplier; check alternate distributor."),
];

describe("newestReply", () => {
  it("finds nothing when staff have never written to this customer", () => {
    assert.equal(newestReply([]), null);
    assert.equal(newestReply([message(INBOUND, RECEIVED), message(INTERNAL, INTERNAL_STATUS)]), null);
  });

  // The defect this covers: the queue row asked about the message it previews,
  // which is the newest of any direction. A note written after a failed reply
  // became the preview, and the row stopped saying the reply had failed while
  // the thread bubble and the composer banner both still did.
  it("is the last reply staff sent, not the last message written", () => {
    assert.equal(newestReply(supersededFailure), supersededFailure[1]);
  });

  it("is the newest reply when several have gone out", () => {
    const thread = [message(OUTBOUND, FAILED, "old"), message(INBOUND, RECEIVED), message(OUTBOUND, DELIVERED, "new")];

    assert.equal(newestReply(thread), thread[2]);
  });
});

describe("hasUndeliveredReply", () => {
  it("is false when staff have never written to this customer", () => {
    assert.equal(hasUndeliveredReply(null), false);
    assert.equal(hasUndeliveredReply(undefined), false);
  });

  // The queue row's marker, on the ordering that used to un-mark it. The first
  // assertion is the answer the row used to get, kept here so the two cannot be
  // confused for the same question again.
  it("still marks the conversation once a later note has taken over the preview", () => {
    const preview = supersededFailure[supersededFailure.length - 1];

    assert.equal(isUndelivered(preview), false);
    assert.equal(hasUndeliveredReply(newestReply(supersededFailure)), true);
  });

  it("stops marking it once a later reply reached the customer", () => {
    const thread = [message(OUTBOUND, FAILED, "old"), message(OUTBOUND, DELIVERED, "new")];

    assert.equal(hasUndeliveredReply(newestReply(thread)), false);
  });
});

describe("lastUndeliveredOutbound", () => {
  it("finds nothing in an empty thread", () => {
    assert.equal(lastUndeliveredOutbound([]), null);
  });

  it("returns the failed reply when it is the advisor's most recent attempt", () => {
    const failed = message(OUTBOUND, FAILED, "Front arrived this morning.");

    assert.equal(lastUndeliveredOutbound([message(INBOUND, RECEIVED), failed]), failed);
  });

  // A later inbound message or internal note does not undo the failure - the
  // customer is still waiting on something that was never sent.
  it("still returns it when the customer or a colleague has spoken since", () => {
    const failed = message(OUTBOUND, FAILED, "Front arrived this morning.");
    const thread = [failed, message(INBOUND, RECEIVED), message(INTERNAL, INTERNAL_STATUS)];

    assert.equal(lastUndeliveredOutbound(thread), failed);
  });

  // A later reply that did go out means she has already moved past it, so the
  // composer must not keep offering the old text back.
  it("returns nothing once a later reply reached the customer", () => {
    const thread = [message(OUTBOUND, FAILED, "old"), message(OUTBOUND, DELIVERED, "new")];

    assert.equal(lastUndeliveredOutbound(thread), null);
  });
});

describe("undeliveredDetail", () => {
  it("passes the recorded cause through", () => {
    assert.equal(
      undeliveredDetail("Carrier rejected message: unreachable destination."),
      "Carrier rejected message: unreachable destination.",
    );
  });

  it("has nothing to add when no cause was recorded", () => {
    assert.equal(undeliveredDetail(null), null);
    assert.equal(undeliveredDetail(undefined), null);
    assert.equal(undeliveredDetail("   "), null);
  });
});

describe("the words the advisor reads", () => {
  it("says the customer never got it, without naming a vendor", () => {
    assert.match(UNDELIVERED_HEADLINE, /never got this/);
    assert.doesNotMatch(UNDELIVERED_HEADLINE, /twilio/i);
  });

  // The old text read "Twilio configuration is incomplete. Review Settings >
  // Integration health." - a vendor and an env var, neither of which an advisor
  // can act on. This names who can fix it instead.
  it("tells her who can reconnect texting, not which vendor broke", () => {
    assert.doesNotMatch(TEXTING_NOT_CONNECTED, /twilio/i);
    assert.match(TEXTING_NOT_CONNECTED, /administrator/i);
  });
});
