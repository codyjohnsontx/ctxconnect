import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { DeliveryStatus, Department, MessageDirection } from "../src/generated/prisma/enums";

// A text Attend has handed to Twilio and not heard back about is a `SENDING`
// row, and while one stands the gate refuses the next text on that thread
// (the table in tests/send-gate.test.ts). This suite asks the database for the
// half the gate cannot promise on its own - one such row per thread - and
// replays the migration that introduced the state over rows written before it.
//
// It writes, so it runs only when TEST_DATABASE_URL names a migrated,
// disposable database; CI's build job points it at its throwaway Postgres.
const databaseUrl = process.env.TEST_DATABASE_URL;

type Db = typeof import("../src/lib/prisma").prisma;

const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
const sendInFlightMigration = "20261101090000_a_send_in_flight_is_its_own_state";

const migration = (name: string) => readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");

/**
 * One statement at a time where it matters, the way `prisma migrate deploy`
 * lands them: an enum value added in a transaction cannot be used until it
 * commits, and Postgres refuses an index built CONCURRENTLY inside a
 * multi-statement query. Every other migration goes whole, because a function
 * body has semicolons of its own.
 */
async function applyMigration(client: Client, name: string) {
  const sql = migration(name);

  if (name !== sendInFlightMigration && !/CONCURRENTLY/.test(sql)) {
    await client.query(sql);
    return;
  }

  for (const statement of sql.split(/;\s*$/m)) {
    if (statement.replace(/--.*$/gm, "").trim()) {
      await client.query(statement);
    }
  }
}

/**
 * Builds the schema as it stood before `SENDING` in a scratch schema of the
 * test database, lets `seed` write rows into it, applies the migration, hands
 * the result to `check`, and drops the schema.
 */
async function withSchemaBeforeSending(seed: (client: Client) => Promise<void>, check: (client: Client) => Promise<void>) {
  const schema = `send_in_flight_${suffix}_${randomUUID().slice(0, 8)}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);

    const earlier = readdirSync(migrationsDir)
      .filter((name) => /^\d/.test(name) && name < sendInFlightMigration)
      .sort();
    for (const name of earlier) {
      await applyMigration(client, name);
    }

    await seed(client);
    await applyMigration(client, sendInFlightMigration);
    await check(client);
  } finally {
    // A migration that failed between its own BEGIN and COMMIT leaves the
    // session in an aborted transaction, which would refuse the drop.
    await client.query("ROLLBACK");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

describe("one send in flight per thread", { skip: !databaseUrl && "TEST_DATABASE_URL is not set" }, () => {
  let prisma: Db;

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("../src/lib/prisma"));
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  async function thread(label: string) {
    const customer = await prisma.customer.create({
      data: { name: `In flight ${suffix} ${label}`, phone: `+1666${suffix.slice(0, 4)}${label}` },
    });

    return prisma.conversation.create({ data: { customerId: customer.id, department: Department.SERVICE } });
  }

  const outbound = (conversationId: string, deliveryStatus: DeliveryStatus) =>
    prisma.message.create({
      data: { conversationId, direction: MessageDirection.OUTBOUND, body: "Yes, ready at 3.", deliveryStatus },
    });

  it("refuses a second SENDING row on one thread, and only that", async () => {
    const one = await thread("001");
    const other = await thread("002");

    await outbound(one.id, DeliveryStatus.SENDING);
    await assert.rejects(outbound(one.id, DeliveryStatus.SENDING), /Unique constraint failed|unique/i);

    // Another thread may have its own, and a thread keeps any number of texts
    // that have settled.
    await outbound(other.id, DeliveryStatus.SENDING);
    await outbound(one.id, DeliveryStatus.SENT);
    await outbound(one.id, DeliveryStatus.FAILED);
  });

  it("is a partial unique index Prisma cannot express, so it lives in the migration alone", async () => {
    const [index] = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'Message_one_send_in_flight_per_thread'`;

    assert.ok(index, "the index exists");
    assert.match(index.indexdef, /CREATE UNIQUE INDEX .* ON .*"Message" USING btree \("conversationId"\) WHERE \("deliveryStatus" = 'SENDING'::"DeliveryStatus"\)/);
  });

  it("settles the unconfirmed sends written before the state existed, newest per thread to SENDING", async () => {
    const minute = (n: number) => new Date(Date.UTC(2026, 9, 30, 12, n)).toISOString();

    await withSchemaBeforeSending(
      async (client) => {
        await client.query(`
          INSERT INTO "Customer" ("id", "name", "phone", "updatedAt") VALUES
            ('cust-a', 'A', '+15550000001', now()), ('cust-b', 'B', '+15550000002', now())`);
        await client.query(`
          INSERT INTO "Conversation" ("id", "customerId", "department", "updatedAt") VALUES
            ('thread-a', 'cust-a', 'SERVICE', now()), ('thread-b', 'cust-b', 'SERVICE', now())`);
        await client.query(
          `INSERT INTO "Message" ("id", "conversationId", "direction", "body", "deliveryStatus", "twilioSid", "createdAt", "updatedAt") VALUES
            ('a-older-orphan', 'thread-a', 'OUTBOUND', 'Ready at 3.', 'QUEUED', NULL, $1, now()),
            ('a-newer-orphan', 'thread-a', 'OUTBOUND', 'Ready at 3.', 'QUEUED', NULL, $2, now()),
            ('a-queued-at-twilio', 'thread-a', 'OUTBOUND', 'Thanks.', 'QUEUED', 'SMqueued', $3, now()),
            ('a-sent', 'thread-a', 'OUTBOUND', 'Earlier.', 'SENT', 'SMsent', $4, now()),
            ('a-customer', 'thread-a', 'INBOUND', 'Is it ready?', 'RECEIVED', NULL, $4, now()),
            ('b-orphan', 'thread-b', 'OUTBOUND', 'On its way.', 'QUEUED', NULL, $1, now())`,
          [minute(1), minute(2), minute(3), minute(0)],
        );
      },
      async (client) => {
        const { rows } = await client.query<{ id: string; deliveryStatus: string; errorMessage: string | null }>(
          `SELECT "id", "deliveryStatus", "errorMessage" FROM "Message" ORDER BY "id"`,
        );

        assert.deepEqual(
          rows.map((row) => [row.id, row.deliveryStatus]),
          [
            ["a-customer", "RECEIVED"],
            ["a-newer-orphan", "SENDING"],
            ["a-older-orphan", "FAILED"],
            ["a-queued-at-twilio", "QUEUED"],
            ["a-sent", "SENT"],
            ["b-orphan", "SENDING"],
          ],
        );
        assert.match(rows.find((row) => row.id === "a-older-orphan")?.errorMessage ?? "", /superseded by a later attempt/);
        assert.equal(rows.find((row) => row.id === "a-newer-orphan")?.errorMessage, null);

        await assert.rejects(
          client.query(
            `INSERT INTO "Message" ("id", "conversationId", "direction", "body", "deliveryStatus", "updatedAt")
             VALUES ('b-second', 'thread-b', 'OUTBOUND', 'Again.', 'SENDING', now())`,
          ),
          /Message_one_send_in_flight_per_thread/,
        );
      },
    );
  });
});
