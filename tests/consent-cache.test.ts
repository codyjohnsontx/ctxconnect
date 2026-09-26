import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import { consentState } from "../src/lib/consent";
import { ConsentEventKind, ConsentMethod, Department, Role, SmsConsentStatus } from "../src/generated/prisma/enums";

// `Customer.smsConsent` is a cache of the ledger (decision 9): the badges read
// it, so it must never say anything `consentState` over the customer's events
// would not. This checks the writer keeps them equal, including for an event
// recorded out of order, and that the database itself refuses what the ledger
// forbids - a staff-recorded consent with nobody named, a method recording the
// wrong kind, and deleting a customer the ledger has evidence about.
//
// It writes, so it runs only when TEST_DATABASE_URL names a migrated,
// disposable database, and is skipped otherwise; CI's build job points it at
// its throwaway Postgres. Unlike the other database suites it cannot clean up
// after itself: consent events are never deleted, and a customer with events
// cannot be (decision 7). Its rows are suffixed so reruns do not collide.
const databaseUrl = process.env.TEST_DATABASE_URL;

type Ledger = typeof import("../src/lib/consent-ledger");
type Db = typeof import("../src/lib/prisma").prisma;

const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
let ledger: Ledger;
let prisma: Db;

async function newCustomer(label: string) {
  return prisma.customer.create({
    data: { name: `Consent ${label}`, phone: `+1999${suffix}${label.length}${Math.floor(Math.random() * 1e6)}` },
  });
}

async function eventsOf(customerId: string) {
  return prisma.consentEvent.findMany({ where: { customerId } });
}

describe("the cached consent status", { skip: !databaseUrl && "TEST_DATABASE_URL is not set" }, () => {
  let recorderId = "";

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ledger = await import("../src/lib/consent-ledger");
    prisma = (await import("../src/lib/prisma")).prisma;

    recorderId = (
      await prisma.user.create({
        data: {
          name: "Consent Recorder",
          email: `consent-${suffix}@ledger.test`,
          passwordHash: "unused",
          role: Role.SERVICE,
          department: Department.SERVICE,
        },
      })
    ).id;
  });

  it("starts at NONE: a customer written without an event is not textable", async () => {
    const customer = await newCustomer("none");
    assert.equal(customer.smsConsent, SmsConsentStatus.NONE);
    assert.equal(customer.smsConsentEventId, null);
  });

  it("follows the ledger's latest event, even when that is not the event just written", async () => {
    const customer = await newCustomer("order");
    const record = (input: Parameters<Ledger["recordConsentEvent"]>[1]) =>
      prisma.$transaction((tx) => ledger.recordConsentEvent(tx, input));

    await record({
      customerId: customer.id,
      kind: ConsentEventKind.GRANTED,
      method: ConsentMethod.CUSTOMER_TEXTED_FIRST,
      occurredAt: new Date("2026-09-01T10:00:00Z"),
    });
    const stop = await record({
      customerId: customer.id,
      kind: ConsentEventKind.REVOKED,
      method: ConsentMethod.KEYWORD_STOP,
      occurredAt: new Date("2026-09-10T10:00:00Z"),
    });
    // Recorded last, but the customer agreed before they texted STOP.
    await record({
      customerId: customer.id,
      kind: ConsentEventKind.GRANTED,
      method: ConsentMethod.VERBAL_AT_COUNTER,
      recordedByUserId: recorderId,
      evidence: "Agreed at the counter when dropping the bike off.",
      occurredAt: new Date("2026-09-05T10:00:00Z"),
    });

    const cached = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(cached.smsConsent, SmsConsentStatus.REVOKED);
    assert.equal(cached.smsConsentEventId, stop.event.id);

    const events = await eventsOf(customer.id);
    assert.equal(events.length, 3);
    assert.ok(events.every((event) => event.phone === customer.phone), "every event carries the number it is for");
  });

  it("keeps a STOP and a START landing together both in the ledger and the cache", async () => {
    const customer = await newCustomer("race");
    const at = (minute: number) => new Date(`2026-09-20T10:${String(minute).padStart(2, "0")}:00Z`);

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        prisma.$transaction((tx) =>
          ledger.recordConsentEvent(tx, {
            customerId: customer.id,
            kind: index % 2 ? ConsentEventKind.REVOKED : ConsentEventKind.GRANTED,
            method: index % 2 ? ConsentMethod.KEYWORD_STOP : ConsentMethod.KEYWORD_START,
            occurredAt: at(index),
          }),
        ),
      ),
    );

    const cached = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    const truth = consentState(await eventsOf(customer.id));
    assert.equal(truth.status, SmsConsentStatus.REVOKED);
    assert.equal(cached.smsConsent, truth.status);
    assert.equal(cached.smsConsentEventId, truth.event?.id);
  });

  it("is refused by the database for a staff-recorded consent with no recorder or no evidence", async () => {
    const customer = await newCustomer("check");
    const base = {
      customerId: customer.id,
      phone: customer.phone,
      kind: ConsentEventKind.GRANTED,
      occurredAt: new Date(),
    };

    await assert.rejects(
      prisma.consentEvent.create({ data: { ...base, method: ConsentMethod.WRITTEN_FORM, evidence: "signed" } }),
    );
    await assert.rejects(
      prisma.consentEvent.create({
        data: { ...base, method: ConsentMethod.VERBAL_AT_COUNTER, recordedByUserId: recorderId, evidence: "  " },
      }),
    );
    // A STOP keyword cannot grant.
    await assert.rejects(prisma.consentEvent.create({ data: { ...base, method: ConsentMethod.KEYWORD_STOP } }));
  });

  it("will not delete a customer the ledger holds evidence about", async () => {
    const customer = await newCustomer("restrict");
    await prisma.$transaction((tx) =>
      ledger.recordConsentEvent(tx, {
        customerId: customer.id,
        kind: ConsentEventKind.REVOKED,
        method: ConsentMethod.KEYWORD_STOP,
        occurredAt: new Date(),
      }),
    );

    await assert.rejects(prisma.customer.delete({ where: { id: customer.id } }));
  });

  it("equals consentState over the ledger for every customer in the database", async () => {
    const customers = await prisma.customer.findMany({
      select: { id: true, name: true, smsConsent: true, smsConsentEventId: true, consentEvents: true },
    });

    for (const customer of customers) {
      const truth = consentState(customer.consentEvents);
      assert.equal(customer.smsConsent, truth.status, `${customer.name}'s cached status`);
      assert.equal(customer.smsConsentEventId, truth.event?.id ?? null, `${customer.name}'s cached event`);
    }
  });
});
