import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  GRANT_KEYWORDS,
  REVIEW_PHRASES,
  REVIEW_WORDS,
  REVOKE_KEYWORDS,
  classifyConsentReply,
  consentMethodRules,
  consentState,
} from "../src/lib/consent";
import {
  ConsentEventKind,
  ConsentMethod,
  Department,
  MessageDirection,
  Role,
  SmsConsentStatus,
} from "../src/generated/prisma/enums";
import { consentReplyCases } from "./consent-reply-cases";

// `Customer.smsConsent` is a cache of the ledger (decision 9): the badges read
// it, so it must never say anything `consentState` over the customer's events
// would not. This checks the writer keeps them equal, including for an event
// recorded out of order, and that the database itself refuses what the ledger
// forbids - a staff-recorded consent with nobody named, a method recording the
// wrong kind, rewriting or deleting an event, and deleting a customer the
// ledger has evidence about. It also replays the consent migration's backfill
// over legacy rows in a scratch schema, and checks the backfill reads a text
// the way the webhook does.
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
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
const consentLedgerMigration = "20260925090000_consent_ledger";
let ledger: Ledger;
let prisma: Db;

async function newCustomer(label: string) {
  return prisma.customer.create({
    data: { name: `Consent ${label}`, phone: `+1999${suffix}${label.length}${Math.floor(Math.random() * 1e6)}` },
  });
}

class RolledBack extends Error {}

// Writes the event and rolls it back, so the cache is never left behind the
// ledger; only a CHECK constraint counts as a refusal.
async function databaseAccepts(data: Parameters<Db["consentEvent"]["create"]>[0]["data"]) {
  const outcome = await prisma
    .$transaction(async (tx) => {
      await tx.consentEvent.create({ data });
      throw new RolledBack();
    })
    .catch((error: unknown) => error);

  if (outcome instanceof RolledBack) {
    return true;
  }

  if (/violates check constraint "ConsentEvent_/.test(String(outcome))) {
    return false;
  }

  throw outcome;
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

  it("is refused by the database for exactly what consentMethodRules forbids", async () => {
    const customer = await newCustomer("check");
    const vouching = [
      {},
      { recordedByUserId: recorderId },
      { evidence: "Signed the service form." },
      { recordedByUserId: recorderId, evidence: "  " },
      { recordedByUserId: recorderId, evidence: "Signed the service form." },
    ];

    for (const method of Object.values(ConsentMethod)) {
      const rule = consentMethodRules[method];

      for (const kind of Object.values(ConsentEventKind)) {
        for (const staff of vouching) {
          const vouched = Boolean(staff.recordedByUserId && staff.evidence?.trim());
          const allowed = rule.kinds.includes(kind) && (!rule.staffRecorded || vouched);

          assert.equal(
            await databaseAccepts({
              customerId: customer.id,
              phone: customer.phone,
              kind,
              method,
              occurredAt: new Date(),
              ...staff,
            }),
            allowed,
            `${method} recording ${kind} with ${JSON.stringify(staff)}`,
          );
        }
      }
    }
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

  it("refuses to rewrite or delete an event, but lets a deleted text clear the link to it", async () => {
    const customer = await newCustomer("append");
    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, department: Department.SERVICE },
    });
    const text = await prisma.message.create({
      data: { conversationId: conversation.id, direction: MessageDirection.INBOUND, body: "STOP" },
    });
    const { event } = await prisma.$transaction((tx) =>
      ledger.recordConsentEvent(tx, {
        customerId: customer.id,
        kind: ConsentEventKind.REVOKED,
        method: ConsentMethod.KEYWORD_STOP,
        messageId: text.id,
        occurredAt: text.createdAt,
      }),
    );

    await assert.rejects(
      prisma.consentEvent.update({
        where: { id: event.id },
        data: { kind: ConsentEventKind.GRANTED, method: ConsentMethod.KEYWORD_START },
      }),
      /append-only/,
    );
    await assert.rejects(
      prisma.consentEvent.update({ where: { id: event.id }, data: { messageId: null } }),
      /append-only/,
    );
    await assert.rejects(prisma.consentEvent.delete({ where: { id: event.id } }), /append-only/);

    await prisma.message.delete({ where: { id: text.id } });
    assert.deepEqual(await prisma.consentEvent.findUniqueOrThrow({ where: { id: event.id } }), {
      ...event,
      messageId: null,
    });
  });

  it("reads a text in the backfill exactly as the webhook reads it", async () => {
    const words = [...REVOKE_KEYWORDS, ...GRANT_KEYWORDS, "YES", ...REVIEW_WORDS, ...REVIEW_PHRASES];
    const texts = [
      ...consentReplyCases.map(([body]) => body),
      ...words.flatMap((word) => [word, word.toLowerCase(), ` ${word}. `, `please ${word.toLowerCase()} now`]),
    ];

    const rows = await prisma.$queryRaw<Array<{ body: string; keyword: string }>>`
      SELECT body, consent_classify_reply(body) AS keyword FROM unnest(${texts}::text[]) AS texts(body)
    `;

    assert.equal(rows.length, texts.length);
    for (const { body, keyword } of rows) {
      assert.equal(keyword, classifyConsentReply(body), JSON.stringify(body));
    }
  });

  it("backfills a legacy customer from the first text that is not a possible stop request", async () => {
    const legacy: Record<string, string[]> = {
      "review first": ["Wrong number, stop texting me", "Sorry, it is my number after all. Is the bike ready?"],
      "review only": ["please don't text this number"],
      ordinary: ["Is my bike ready?"],
      "stop first": ["STOP", "Is my bike ready?"],
      "stop then yes": ["STOP", "yes"],
    };

    const schema = `consent_backfill_${suffix}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);

      const migration = (name: string) => readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
      const earlier = readdirSync(migrationsDir)
        .filter((name) => /^\d/.test(name) && name < consentLedgerMigration)
        .sort();
      // One statement at a time, because one of them builds an index
      // CONCURRENTLY, which Postgres refuses inside a multi-statement query.
      for (const name of earlier) {
        for (const statement of migration(name).split(/;\s*$/m)) {
          await client.query(statement);
        }
      }

      for (const [index, [name, bodies]] of Object.entries(legacy).entries()) {
        await client.query(
          `INSERT INTO "Customer" ("id", "name", "phone", "updatedAt") VALUES ($1, $2, $3, now())`,
          [`c${index}`, name, `+1555000000${index}`],
        );
        await client.query(
          `INSERT INTO "Conversation" ("id", "customerId", "department", "updatedAt") VALUES ($1, $1, 'SERVICE', now())`,
          [`c${index}`],
        );
        for (const [position, body] of bodies.entries()) {
          await client.query(
            `INSERT INTO "Message" ("id", "conversationId", "direction", "body", "createdAt", "updatedAt")
             VALUES ($1, $2, 'INBOUND', $3, timestamp '2026-09-01 10:00' + $4 * interval '1 minute', now())`,
            [`c${index}m${position}`, `c${index}`, body, position],
          );
        }
      }

      await client.query(migration(consentLedgerMigration));

      const { rows } = await client.query<{
        name: string;
        status: string;
        method: string | null;
        messageId: string | null;
        methods: string[] | null;
      }>(`
        SELECT cu.name, cu."smsConsent"::text AS status, e.method::text AS method, e."messageId",
          (SELECT array_agg(all_events.method::text ORDER BY all_events."occurredAt")
           FROM "ConsentEvent" all_events WHERE all_events."customerId" = cu.id) AS methods
        FROM "Customer" cu
        LEFT JOIN "ConsentEvent" e ON e.id = cu."smsConsentEventId"
      `);

      assert.deepEqual(Object.fromEntries(rows.map(({ name, ...rest }) => [name, rest])), {
        "review first": {
          status: "GRANTED",
          method: "BACKFILL_FIRST_INBOUND",
          messageId: "c0m1",
          methods: ["BACKFILL_FIRST_INBOUND"],
        },
        "review only": { status: "NONE", method: null, messageId: null, methods: null },
        ordinary: { status: "GRANTED", method: "BACKFILL_FIRST_INBOUND", messageId: "c2m0", methods: ["BACKFILL_FIRST_INBOUND"] },
        "stop first": { status: "REVOKED", method: "KEYWORD_STOP", messageId: "c3m0", methods: ["KEYWORD_STOP"] },
        "stop then yes": {
          status: "GRANTED",
          method: "KEYWORD_START",
          messageId: "c4m1",
          methods: ["KEYWORD_STOP", "KEYWORD_START"],
        },
      });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
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
