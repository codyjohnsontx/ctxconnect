import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageDirection } from "../src/generated/prisma/client";
import { previewAttribution } from "../src/lib/message-preview";

const READER = "user-alyssa";
const OTHER = "user-cody";

const inbound = { direction: MessageDirection.INBOUND, senderUserId: null, sender: null };
const myReply = {
  direction: MessageDirection.OUTBOUND,
  senderUserId: READER,
  sender: { name: "Alyssa Torres" },
};
const theirReply = {
  direction: MessageDirection.OUTBOUND,
  senderUserId: OTHER,
  sender: { name: "Cody Johnson" },
};
const myNote = {
  direction: MessageDirection.INTERNAL,
  senderUserId: READER,
  sender: { name: "Alyssa Torres" },
};
const theirNote = {
  direction: MessageDirection.INTERNAL,
  senderUserId: OTHER,
  sender: { name: "Cody Johnson" },
};

describe("previewAttribution", () => {
  it("leaves a customer message unlabelled", () => {
    // The whole point of the label is that it marks the exception. Labelling
    // the customer too would make the row's default reading ambiguous again.
    assert.equal(previewAttribution(inbound, READER), null);
  });

  it("has nothing to say about a thread with no messages", () => {
    assert.equal(previewAttribution(null, READER), null);
    assert.equal(previewAttribution(undefined, READER), null);
  });

  it("names the reader's own reply as hers", () => {
    assert.deepEqual(previewAttribution(myReply, READER), { label: "You:", author: "staff" });
  });

  it("names a colleague's reply with their first name", () => {
    // A shared inbox: "did I answer this, or did someone else?" is a different
    // question from "has this been answered".
    assert.deepEqual(previewAttribution(theirReply, READER), { label: "Cody:", author: "staff" });
  });

  it("marks the reader's own note as a note without naming her", () => {
    assert.deepEqual(previewAttribution(myNote, READER), { label: "Note:", author: "note" });
  });

  it("names a colleague's note", () => {
    assert.deepEqual(previewAttribution(theirNote, READER), {
      label: "Note from Cody:",
      author: "note",
    });
  });

  it("distinguishes a note from a reply so the two never share a label", () => {
    const reply = previewAttribution(theirReply, READER);
    const note = previewAttribution(theirNote, READER);
    assert.notEqual(reply!.label, note!.label);
    assert.notEqual(reply!.author, note!.author);
  });

  it("reads the same message differently for each reader", () => {
    // The seeded Jules Bennett row: "You:" to Dana who wrote it, "Dana:" to
    // everyone else looking at the same queue.
    const dana = { direction: MessageDirection.OUTBOUND, senderUserId: "u-dana", sender: { name: "Dana Parker" } };
    assert.equal(previewAttribution(dana, "u-dana")!.label, "You:");
    assert.equal(previewAttribution(dana, OTHER)!.label, "Dana:");
  });

  it("never claims a message with no sender is the reader's", () => {
    // Sender is set null when a staff account is deleted. A blank id matching a
    // blank reader id would turn a stranger's reply into "You:".
    const orphaned = { direction: MessageDirection.OUTBOUND, senderUserId: null, sender: null };
    assert.deepEqual(previewAttribution(orphaned, null), { label: "Staff:", author: "staff" });
    assert.deepEqual(previewAttribution(orphaned, READER), { label: "Staff:", author: "staff" });

    const orphanedNote = { direction: MessageDirection.INTERNAL, senderUserId: null, sender: null };
    assert.deepEqual(previewAttribution(orphanedNote, null), { label: "Note:", author: "note" });
  });

  it("falls back cleanly when the sender row is missing or blank", () => {
    const noName = { direction: MessageDirection.OUTBOUND, senderUserId: OTHER, sender: { name: "  " } };
    assert.equal(previewAttribution(noName, READER)!.label, "Staff:");

    const noRow = { direction: MessageDirection.OUTBOUND, senderUserId: OTHER, sender: undefined };
    assert.equal(previewAttribution(noRow, READER)!.label, "Staff:");

    const nullName = { direction: MessageDirection.INTERNAL, senderUserId: OTHER, sender: { name: null } };
    assert.equal(previewAttribution(nullName, READER)!.label, "Note:");
  });

  it("uses the first name only, whatever the name looks like", () => {
    const cases: Array<[string, string]> = [
      ["Cody Johnson", "Cody:"],
      ["  Dana   Parker  ", "Dana:"],
      ["Mason", "Mason:"],
      ["Ana Maria de la Cruz", "Ana:"],
    ];

    for (const [name, label] of cases) {
      const message = { direction: MessageDirection.OUTBOUND, senderUserId: OTHER, sender: { name } };
      assert.equal(previewAttribution(message, READER)!.label, label, name);
    }
  });

  it("ends every label with a colon so the row reads as one sentence", () => {
    const messages = [myReply, theirReply, myNote, theirNote];

    for (const message of messages) {
      const attribution = previewAttribution(message, READER)!;
      assert.ok(attribution.label.endsWith(":"), attribution.label);
      assert.ok(!attribution.label.endsWith(" :"), attribution.label);
    }
  });
});
