import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { attendedSinceInbound, slaMinutesForDepartment } from "../src/lib/sla";
import { Department, MessageDirection } from "../src/generated/prisma/enums";

// The breach alert says one thing: this customer texted and nobody has seen to
// them since. What counts as seeing to them is the whole rule, and it is not
// "anything happened on the thread" - handing a conversation to a colleague
// happens on the thread and answers nobody.

const inboundAt = new Date("2026-09-09T09:00:00.000Z");
const after = (minutes: number) => new Date(inboundAt.getTime() + minutes * 60_000);
const before = (minutes: number) => new Date(inboundAt.getTime() - minutes * 60_000);

const reply = (at: Date) => ({
  createdAt: at,
  direction: MessageDirection.OUTBOUND,
  systemGenerated: false,
});

const personalNote = (at: Date) => ({
  createdAt: at,
  direction: MessageDirection.INTERNAL,
  systemGenerated: false,
});

const systemNote = (at: Date) => ({
  createdAt: at,
  direction: MessageDirection.INTERNAL,
  systemGenerated: true,
});

describe("attendedSinceInbound", () => {
  it("says nobody has, when nothing followed the customer's text", () => {
    assert.equal(attendedSinceInbound(inboundAt, []), false);
    assert.equal(
      attendedSinceInbound(inboundAt, [
        { createdAt: inboundAt, direction: MessageDirection.INBOUND, systemGenerated: false },
      ]),
      false,
    );
  });

  it("counts a reply to the customer", () => {
    assert.equal(attendedSinceInbound(inboundAt, [reply(after(5))]), true);
  });

  it("counts an advisor's own internal note", () => {
    // This is the case that decided the shape of the rule. "Called her, left a
    // voicemail" is somebody doing the work, and an alert that kept shouting
    // through it would send a manager to chase an already-chased customer. It
    // is why the rule is not simply OUTBOUND-only - if this test ever goes red
    // because the rule was narrowed to replies, the cheaper fix has been put
    // back and the voicemail note thrown away with the bookkeeping.
    assert.equal(attendedSinceInbound(inboundAt, [personalNote(after(5))]), true);
  });

  it("does not count a note Attend wrote itself", () => {
    // Coverage and ordinary reassignment both write one of these on every
    // thread they move. The customer is still waiting, so the alert stays.
    assert.equal(attendedSinceInbound(inboundAt, [systemNote(after(5))]), false);

    // And several of them - an advisor's whole book handed over, then handed
    // back - are still nobody answering the customer.
    assert.equal(
      attendedSinceInbound(inboundAt, [systemNote(after(5)), systemNote(after(90))]),
      false,
    );
  });

  it("still sees the person's work when bookkeeping happened after it", () => {
    // The order the real rows arrive in: an advisor answers, then coverage
    // moves the thread. The hand-off must not undo the answer.
    assert.equal(
      attendedSinceInbound(inboundAt, [reply(after(5)), systemNote(after(30))]),
      true,
    );
    assert.equal(
      attendedSinceInbound(inboundAt, [personalNote(after(5)), systemNote(after(30))]),
      true,
    );
  });

  it("ignores everything from before the customer's last text", () => {
    // An answer to the customer's PREVIOUS message is not an answer to this
    // one; they have written again and are waiting again.
    assert.equal(attendedSinceInbound(inboundAt, [reply(before(30))]), false);
    assert.equal(attendedSinceInbound(inboundAt, [personalNote(before(30))]), false);

    // Exactly at the inbound instant counts as not-after, so a row written in
    // the same tick as the customer's text cannot answer it.
    assert.equal(attendedSinceInbound(inboundAt, [reply(inboundAt)]), false);
  });
});

describe("slaMinutesForDepartment", () => {
  it("gives each department its own allowance", () => {
    assert.equal(slaMinutesForDepartment(Department.SALES), 15);
    assert.equal(slaMinutesForDepartment(Department.SERVICE), 120);
    assert.equal(slaMinutesForDepartment(Department.PARTS), 240);
    assert.equal(slaMinutesForDepartment(Department.FINANCE), 60);
    assert.equal(slaMinutesForDepartment(Department.GENERAL), 60);
  });
});

describe("the notes Attend writes on its own behalf", () => {
  const actions = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "actions.ts"),
    "utf8",
  );

  const serverAction = (name: string) => {
    const start = actions.indexOf(`export async function ${name}(`);

    assert.notEqual(start, -1, `${name} not found`);

    const next = actions.indexOf("\nexport async function ", start + 1);

    return actions.slice(start, next === -1 ? undefined : next);
  };

  it("marks every note written while a conversation changes hands", () => {
    // A marker applied at one write site and missed at another reads as a whole
    // fix and behaves like none: the missed site goes on withdrawing breach
    // alerts. Ordinary reassignment is listed here because it is where this bug
    // lived before coverage ever existed.
    for (const name of [
      "updateConversation",
      "startConversationCoverage",
      "endConversationCoverage",
    ]) {
      const body = serverAction(name);

      for (const note of body.split("kind: MessageKind.NOTE,").slice(1)) {
        assert.match(
          note.slice(0, 600),
          /systemGenerated: true/,
          `${name} writes a note without marking it as Attend's own`,
        );
      }
    }
  });

  it("leaves a note a person typed unmarked", () => {
    // The whole point of the marker is that this one still counts.
    assert.doesNotMatch(serverAction("addInternalNote"), /systemGenerated/);
  });
});
