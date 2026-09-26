import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  type ConsentEventFacts,
  cachedConsentState,
  consentBlockMessage,
  consentMethodRules,
  consentState,
  describeConsent,
  inboundConsentEffect,
} from "../src/lib/consent";
import { ConsentChannel, ConsentEventKind, ConsentMethod, SmsConsentStatus } from "../src/generated/prisma/enums";

// Consent used to be two booleans on Customer that defaulted to "consented".
// It is now a ledger, and these pin the rule that reads it, the pairing of
// method to kind, and that only one writer touches it.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let nextId = 0;

function event(
  kind: ConsentEventKind,
  occurredAt: string,
  overrides: Partial<ConsentEventFacts> = {},
): ConsentEventFacts {
  nextId += 1;

  return {
    id: `e${String(nextId).padStart(4, "0")}`,
    channel: ConsentChannel.SMS,
    kind,
    method: kind === ConsentEventKind.GRANTED ? ConsentMethod.CUSTOMER_TEXTED_FIRST : ConsentMethod.KEYWORD_STOP,
    occurredAt: new Date(occurredAt),
    createdAt: new Date("2026-09-25T12:00:00Z"),
    ...overrides,
  };
}

describe("consentState", () => {
  it("is NONE with no events: nobody is consented by default", () => {
    assert.deepEqual(consentState([]), { status: SmsConsentStatus.NONE, since: null, event: null });
  });

  it("is GRANTED after STOP then START, and REVOKED after START then STOP", () => {
    const stop = event(ConsentEventKind.REVOKED, "2026-09-01T10:00:00Z");
    const start = event(ConsentEventKind.GRANTED, "2026-09-02T10:00:00Z", { method: ConsentMethod.KEYWORD_START });

    assert.equal(consentState([stop, start]).status, SmsConsentStatus.GRANTED);
    assert.equal(consentState([start, stop]).status, SmsConsentStatus.GRANTED);
    assert.equal(
      consentState([
        event(ConsentEventKind.GRANTED, "2026-09-01T10:00:00Z"),
        event(ConsentEventKind.REVOKED, "2026-09-02T10:00:00Z"),
      ]).status,
      SmsConsentStatus.REVOKED,
    );
  });

  it("orders by when the customer acted, not when the row was written", () => {
    // A verbal consent written up today for last week does not outrank the
    // STOP the customer texted in between.
    const stop = event(ConsentEventKind.REVOKED, "2026-09-20T10:00:00Z", {
      createdAt: new Date("2026-09-20T10:00:01Z"),
    });
    const lateRecordedGrant = event(ConsentEventKind.GRANTED, "2026-09-15T10:00:00Z", {
      method: ConsentMethod.VERBAL_AT_COUNTER,
      createdAt: new Date("2026-09-25T10:00:00Z"),
    });

    const state = consentState([lateRecordedGrant, stop]);
    assert.equal(state.status, SmsConsentStatus.REVOKED);
    assert.equal(state.event, stop);
    assert.deepEqual(state.since, stop.occurredAt);
  });

  it("breaks a tie on occurredAt by createdAt, then id, whatever order the rows came in", () => {
    const at = "2026-09-20T10:00:00Z";
    const earlierRow = event(ConsentEventKind.GRANTED, at, { createdAt: new Date("2026-09-20T10:00:00Z") });
    const laterRow = event(ConsentEventKind.REVOKED, at, { createdAt: new Date("2026-09-20T10:00:05Z") });

    assert.equal(consentState([earlierRow, laterRow]).event, laterRow);
    assert.equal(consentState([laterRow, earlierRow]).event, laterRow);

    const a = event(ConsentEventKind.GRANTED, at, { id: "a" });
    const b = event(ConsentEventKind.REVOKED, at, { id: "b" });
    assert.equal(consentState([a, b]).event, b);
    assert.equal(consentState([b, a]).event, b);
  });
});

describe("the methods", () => {
  it("classifies every method as GRANTED-only, REVOKED-only or either", () => {
    // consentMethodRules is a Record over the enum, so a new method does not
    // compile unclassified; this also fails if one is classified as nothing.
    for (const method of Object.values(ConsentMethod)) {
      const kinds = consentMethodRules[method].kinds;
      assert.ok(kinds.length >= 1 && kinds.length <= 2, `${method} records ${kinds.length} kinds`);
    }
  });

  it("needs a recorder and evidence for consent given at the counter or on a form", () => {
    // Decision 12.
    assert.ok(consentMethodRules[ConsentMethod.VERBAL_AT_COUNTER].staffRecorded);
    assert.ok(consentMethodRules[ConsentMethod.WRITTEN_FORM].staffRecorded);
  });
});

describe("inboundConsentEffect", () => {
  const cases: Array<[SmsConsentStatus, string, ConsentMethod | null]> = [
    // A customer Attend has no record for, texting in, is the customer texting first.
    [SmsConsentStatus.NONE, "Is my bike ready?", ConsentMethod.CUSTOMER_TEXTED_FIRST],
    [SmsConsentStatus.NONE, "yes", ConsentMethod.CUSTOMER_TEXTED_FIRST],
    // A first-ever STOP grants nothing on the way to revoking.
    [SmsConsentStatus.NONE, "STOP", ConsentMethod.KEYWORD_STOP],
    [SmsConsentStatus.NONE, "START", ConsentMethod.KEYWORD_START],
    // A possible stop request in other words is never texting first.
    [SmsConsentStatus.NONE, "wrong number, stop texting me", null],
    [SmsConsentStatus.GRANTED, "Is my bike ready?", null],
    [SmsConsentStatus.GRANTED, "yes", null],
    [SmsConsentStatus.GRANTED, "Stop.", ConsentMethod.KEYWORD_STOP],
    [SmsConsentStatus.GRANTED, "stop please", null],
    // Decision 4: an ordinary text after a STOP restores nothing.
    [SmsConsentStatus.REVOKED, "ok what time do you open", null],
    // Decision 8: YES re-subscribes only from REVOKED.
    [SmsConsentStatus.REVOKED, "Yes", ConsentMethod.KEYWORD_START],
    [SmsConsentStatus.REVOKED, "unstop", ConsentMethod.KEYWORD_START],
    [SmsConsentStatus.REVOKED, "STOP", ConsentMethod.KEYWORD_STOP],
  ];

  for (const [current, body, method] of cases) {
    it(`${current} + ${JSON.stringify(body)} records ${method ?? "nothing"}`, () => {
      const effect = inboundConsentEffect(current, body);
      assert.equal(effect?.method ?? null, method);

      if (effect) {
        assert.ok(consentMethodRules[effect.method].kinds.includes(effect.kind));
      }
    });
  }
});

describe("describeConsent", () => {
  it("says no consent on record, in red, for NONE", () => {
    const described = describeConsent(consentState([]));
    assert.equal(described.label, "No consent on record");
    assert.equal(described.tone, "red");
    assert.equal(described.since, null);
  });

  it("says since when and why, and leaves the printing of the moment to the browser", () => {
    const stop = event(ConsentEventKind.REVOKED, "2026-09-03T15:00:00Z");
    const described = describeConsent(consentState([stop]));

    assert.equal(described.label, "Opted out");
    assert.equal(described.reason, "they replied STOP");
    assert.equal(described.since, stop.occurredAt);
    assert.equal(described.tone, "red");

    const granted = describeConsent(
      consentState([event(ConsentEventKind.GRANTED, "2026-09-03T15:00:00Z", { method: ConsentMethod.WRITTEN_FORM })]),
    );
    assert.equal(granted.label, "Texting allowed");
    assert.equal(granted.reason, "they signed a written form");
    assert.equal(granted.tone, "green");
  });

  it("reads the same from the cache as from the ledger", () => {
    const events = [
      event(ConsentEventKind.GRANTED, "2026-09-01T10:00:00Z"),
      event(ConsentEventKind.REVOKED, "2026-09-02T10:00:00Z"),
    ];
    const fromLedger = consentState(events);
    const fromCache = cachedConsentState({ smsConsent: fromLedger.status, smsConsentEvent: fromLedger.event });

    assert.deepEqual(describeConsent(fromCache), describeConsent(fromLedger));
    assert.equal(describeConsent(cachedConsentState({ smsConsent: SmsConsentStatus.GRANTED })).label, "Texting allowed");
  });

  it("blocks the composer for everything but a grant", () => {
    assert.equal(consentBlockMessage(SmsConsentStatus.GRANTED), null);
    assert.match(consentBlockMessage(SmsConsentStatus.REVOKED) ?? "", /START/);
    assert.match(consentBlockMessage(SmsConsentStatus.NONE) ?? "", /No consent on record/);
  });
});

describe("the ledger has one writer and is never rewritten", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "generated" ? [] : sourceFiles(path);
      }

      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
  }

  const files = ["src", "prisma", "scripts"]
    .filter((dir) => existsSync(join(repoRoot, dir)))
    .flatMap((dir) => sourceFiles(join(repoRoot, dir)))
    .map((path) => ({ path: relative(repoRoot, path), text: readFileSync(path, "utf8") }));

  it("never updates or deletes a ConsentEvent", () => {
    // Decision 7: a correction is a new STAFF_CORRECTION event, never an edit.
    const offenders = files.filter(({ text }) =>
      /consentEvent\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(text) ||
      /(UPDATE|DELETE\s+FROM)\s+"ConsentEvent"/i.test(text),
    );
    assert.deepEqual(offenders.map(({ path }) => path), []);
  });

  it("creates events, and writes the cached status, only in recordConsentEvent", () => {
    const creators = files.filter(({ text }) => /consentEvent\s*\.\s*create(Many)?\b/.test(text));
    assert.deepEqual(creators.map(({ path }) => path), ["src/lib/consent-ledger.ts"]);

    // A write names the column inside a `data` block; a read selects it or
    // passes it along, which is fine anywhere.
    const cacheWriters = files.filter(({ text }) => /data\s*:\s*\{[^}]*\bsmsConsent/.test(text));
    assert.deepEqual(cacheWriters.map(({ path }) => path), ["src/lib/consent-ledger.ts"]);
  });
});
