import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import twilio from "twilio";
import {
  ConsentEventKind,
  ConsentMethod,
  DeliveryStatus,
  Department,
  MessageDirection,
  NotificationType,
  Role,
} from "../src/generated/prisma/enums";

// A text Attend has handed to Twilio and not heard back about is a `SENDING`
// row, and while one stands the gate refuses the next text on that thread
// (the table in tests/send-gate.test.ts). This suite asks the database for the
// half the gate cannot promise on its own - one such row per thread - and
// replays the migration that introduced the state over rows written before it.
// Then it drives how a SENDING row settles: Twilio's status callback, which
// names the row in its URL, and the reconciler, which asks a fake of Twilio's
// message list on the thread page and before the next send.
//
// It writes, so it runs only when TEST_DATABASE_URL names a migrated,
// disposable database; CI's build job points it at its throwaway Postgres.
const databaseUrl = process.env.TEST_DATABASE_URL;

type Db = typeof import("../src/lib/prisma").prisma;
type SmsSend = typeof import("../src/lib/sms-send");
type Ledger = typeof import("../src/lib/consent-ledger");
type StatusRoute = typeof import("../src/app/api/twilio/status/route");
type Settlement = typeof import("../src/lib/send-settlement");
type TwilioMessage = import("../src/lib/send-settlement").TwilioMessage;

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

// Stand-ins, never real credentials: the token only signs and verifies the
// callbacks below, and the URL is where the send tells Twilio to report.
const AUTH_TOKEN = "test-auth-token-not-a-secret";
const APP_URL = "https://attend.example.test";

describe("a send settled by Twilio's callback", { skip: !databaseUrl && "TEST_DATABASE_URL is not set" }, () => {
  let prisma: Db;
  let smsSend: SmsSend;
  let ledger: Ledger;
  let statusRoute: StatusRoute;
  let settlement: Settlement;
  let advisorId: string;
  let count = 0;

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
    ({ prisma } = await import("../src/lib/prisma"));
    smsSend = await import("../src/lib/sms-send");
    ledger = await import("../src/lib/consent-ledger");
    statusRoute = await import("../src/app/api/twilio/status/route");
    settlement = await import("../src/lib/send-settlement");

    const advisor = await prisma.user.create({
      data: {
        name: `In flight ${suffix}`,
        email: `in-flight-${suffix}@example.test`,
        passwordHash: "x",
        role: Role.SERVICE,
        department: Department.SERVICE,
      },
    });
    advisorId = advisor.id;

    // Someone for a failed send's alert to reach.
    await prisma.user.create({
      data: {
        name: `In flight manager ${suffix}`,
        email: `in-flight-manager-${suffix}@example.test`,
        passwordHash: "x",
        role: Role.MANAGER,
      },
    });
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  /** A customer who texted the store first, as the webhook records one. */
  async function customerWhoTexted() {
    count += 1;
    const phone = `+1777${suffix.slice(0, 4)}${String(count).padStart(3, "0")}`;
    const customer = await prisma.customer.create({ data: { name: `In flight ${suffix} ${count}`, phone } });
    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, department: Department.SERVICE, assignedUserId: advisorId },
      include: { customer: true },
    });
    const text = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        body: "Is my bike ready?",
        deliveryStatus: DeliveryStatus.RECEIVED,
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.$transaction((tx) =>
      ledger.recordConsentEvent(tx, {
        customerId: customer.id,
        kind: ConsentEventKind.GRANTED,
        method: ConsentMethod.CUSTOMER_TEXTED_FIRST,
        messageId: text.id,
        occurredAt: text.createdAt,
      }),
    );

    return conversation;
  }

  const target = (conversation: Awaited<ReturnType<typeof customerWhoTexted>>, body = "Yes, ready at 3.") => ({
    userId: advisorId,
    conversation,
    body,
  });

  const outbound = (conversationId: string) =>
    prisma.message.findMany({ where: { conversationId, direction: MessageDirection.OUTBOUND }, orderBy: { createdAt: "asc" } });

  /** Twilio's status callback, signed the way Twilio signs it, to the URL it was given. */
  async function callback(url: string, fields: Record<string, string>) {
    const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, fields);
    const response = await statusRoute.POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
        body: new URLSearchParams(fields).toString(),
      }),
    );

    assert.equal(response.status, 200);
    return response.text();
  }

  it("hands Twilio a callback URL naming the row", async () => {
    const conversation = await customerWhoTexted();
    const handed: Array<{ statusCallback?: string }> = [];

    const outcome = await smsSend.sendCustomerText(target(conversation), {
      transport: async (message) => {
        handed.push(message);
        return { sid: `SMurl${suffix}${count}` };
      },
    });

    assert.equal(outcome.status, 200);
    assert.equal(handed[0].statusCallback, `${APP_URL}/api/twilio/status?messageId=${outcome.payload.messageId}`);
    assert.equal(smsSend.statusCallbackUrl("abc"), `${APP_URL}/api/twilio/status?messageId=abc`);
  });

  it("keeps what Twilio's callback said when it lands before Attend records the send", async () => {
    const conversation = await customerWhoTexted();
    const sid = `SMearly${suffix}${count}`;

    const outcome = await smsSend.sendCustomerText(target(conversation), {
      transport: async (message) => {
        // Twilio has created the message and reports it delivered before its
        // answer to the create call reaches Attend.
        assert.ok(message.statusCallback);
        assert.equal(await callback(message.statusCallback, { MessageSid: sid, MessageStatus: "delivered" }), "ok");
        return { sid };
      },
    });

    assert.equal(outcome.status, 200);
    const [row] = await outbound(conversation.id);
    assert.equal(row.twilioSid, sid);
    assert.equal(row.deliveryStatus, DeliveryStatus.DELIVERED, "the SENT write must not downgrade what Twilio said");
  });

  it("settles a send whose answer was lost, by the id in the URL, and lets the next text go", async () => {
    const conversation = await customerWhoTexted();
    let statusCallback = "";

    const lost = await smsSend.sendCustomerText(target(conversation), {
      transport: async (message) => {
        statusCallback = message.statusCallback ?? "";
        throw Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ETIMEDOUT" });
      },
    });
    assert.equal(lost.status, 500);
    assert.equal((await outbound(conversation.id))[0].deliveryStatus, DeliveryStatus.SENDING);

    const sid = `SMlate${suffix}${count}`;
    assert.equal(await callback(statusCallback, { MessageSid: sid, MessageStatus: "sent" }), "ok");

    const [settled] = await outbound(conversation.id);
    assert.equal(settled.deliveryStatus, DeliveryStatus.SENT);
    assert.equal(settled.twilioSid, sid);

    const next = await smsSend.sendCustomerText(target(conversation, "See you then."), {
      transport: async () => ({ sid: `SMnext${suffix}${count}` }),
    });
    assert.equal(next.status, 200);
  });

  it("does not let a URL's id claim a row Twilio already named with another sid", async () => {
    const conversation = await customerWhoTexted();
    const sent = await smsSend.sendCustomerText(target(conversation), {
      transport: async () => ({ sid: `SMmine${suffix}${count}` }),
    });

    const url = smsSend.statusCallbackUrl(String(sent.payload.messageId)) ?? "";
    assert.equal(await callback(url, { MessageSid: `SMother${suffix}${count}`, MessageStatus: "failed" }), "ignored");

    const [row] = await outbound(conversation.id);
    assert.equal(row.twilioSid, `SMmine${suffix}${count}`);
    assert.equal(row.deliveryStatus, DeliveryStatus.SENT);
  });

  /** A send whose answer was lost, made to have been handed to Twilio `ageMs` ago. */
  async function unconfirmedSend(ageMs: number) {
    const conversation = await customerWhoTexted();
    const lost = await smsSend.sendCustomerText(target(conversation), {
      transport: async () => {
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      },
    });
    assert.equal(lost.status, 500);

    const createdAt = new Date(Date.now() - ageMs);
    const row = await prisma.message.update({ where: { id: String(lost.payload.messageId) }, data: { createdAt } });
    assert.equal(row.deliveryStatus, DeliveryStatus.SENDING);

    return { conversation, row };
  }

  const atTwilio = (row: { body: string; createdAt: Date }, phone: string, sid: string): TwilioMessage => ({
    sid,
    to: phone,
    body: row.body,
    direction: "outbound-api",
    dateCreated: new Date(row.createdAt.getTime() + 300),
  });

  const thread = (conversation: Awaited<ReturnType<typeof customerWhoTexted>>) => ({
    customerId: conversation.customerId,
    conversationId: conversation.id,
  });

  const twoMinutes = () => settlement.SEND_SETTLEMENT_MS + 5_000;

  it("settles a stale send Twilio has as sent, on the thread page, and opens the composer again", async () => {
    const { conversation, row } = await unconfirmedSend(settlement.SEND_GRACE_MS + 5_000);
    const sid = `SMfound${suffix}${count}`;
    const asked: Array<{ to: string; limit: number }> = [];

    const block = await smsSend.previewSendBlock(thread(conversation), undefined, {
      lookup: async (query) => {
        asked.push(query);
        return [atTwilio(row, conversation.customer.phone, sid)];
      },
    });

    assert.equal(block, null);
    assert.deepEqual(asked, [{ to: conversation.customer.phone, limit: settlement.TWILIO_LOOKUP_LIMIT }]);
    const [settled] = await outbound(conversation.id);
    assert.equal(settled.deliveryStatus, DeliveryStatus.SENT);
    assert.equal(settled.twilioSid, sid);
  });

  it("settles a stale send Twilio never got as failed, before the next send, and lets the rewrite go once", async () => {
    const { conversation } = await unconfirmedSend(twoMinutes());
    const twilio: string[] = [];

    const rewrite = await smsSend.sendCustomerText(target(conversation, "Yes, ready at 3pm."), {
      lookup: async () => [],
      transport: async (message) => {
        twilio.push(message.body);
        return { sid: `SMrewrite${suffix}${count}` };
      },
    });

    assert.equal(rewrite.status, 200);
    assert.deepEqual(twilio, ["Yes, ready at 3pm."]);
    const [failed, sent] = await outbound(conversation.id);
    assert.equal(failed.deliveryStatus, DeliveryStatus.FAILED);
    assert.equal(failed.errorMessage, settlement.NEVER_REACHED_TWILIO);
    assert.match(failed.errorMessage ?? "", /^Did not reach Twilio/);
    assert.equal(sent.deliveryStatus, DeliveryStatus.SENT);
    assert.ok(
      (await prisma.notification.count({
        where: { conversationId: conversation.id, messageId: failed.id, type: NotificationType.MESSAGE_FAILED },
      })) > 0,
      "managers are told a text did not go",
    );
  });

  it("leaves a stale send standing while Twilio's silence is not yet proof", async () => {
    const { conversation } = await unconfirmedSend(settlement.SEND_GRACE_MS + 5_000);

    const block = await smsSend.previewSendBlock(thread(conversation), undefined, { lookup: async () => [] });

    assert.equal(block?.reason, "SEND_UNCONFIRMED");
    assert.equal((await outbound(conversation.id))[0].deliveryStatus, DeliveryStatus.SENDING);
  });

  it("keeps the thread held when Twilio cannot be asked", async () => {
    const { conversation } = await unconfirmedSend(twoMinutes());

    const refused = await smsSend.sendCustomerText(target(conversation), {
      lookup: async () => {
        throw Object.assign(new Error("[HTTP 503] Service Unavailable"), { status: 503 });
      },
      transport: async () => {
        throw new Error("Twilio was called while the last text is unconfirmed.");
      },
    });

    assert.equal(refused.status, 403);
    assert.equal(refused.payload.reason, "SEND_UNCONFIRMED");
    assert.equal((await outbound(conversation.id))[0].deliveryStatus, DeliveryStatus.SENDING);

    // And when texting is not connected at all, there is nobody to ask.
    const block = await smsSend.previewSendBlock(thread(conversation), undefined, { lookup: null });
    assert.equal(block?.reason, "SEND_UNCONFIRMED");
  });

  it("does not ask Twilio about a send still inside the grace period", async () => {
    const { conversation } = await unconfirmedSend(1_000);

    const block = await smsSend.previewSendBlock(thread(conversation), undefined, {
      lookup: async () => {
        throw new Error("Twilio was asked about a send inside the grace period.");
      },
    });

    assert.equal(block?.reason, "SEND_UNCONFIRMED");
  });

  it("does not claim the Twilio message an earlier text with the same words already holds", async () => {
    const conversation = await customerWhoTexted();
    const earlierSid = `SMearlier${suffix}${count}`;
    const first = await smsSend.sendCustomerText(target(conversation, "Yes."), {
      transport: async () => ({ sid: earlierSid }),
    });
    assert.equal(first.status, 200);
    const second = await smsSend.sendCustomerText(target(conversation, "Yes."), {
      lookup: async () => [],
      transport: async () => {
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      },
    });
    const row = await prisma.message.update({
      where: { id: String(second.payload.messageId) },
      data: { createdAt: new Date(Date.now() - twoMinutes()) },
    });

    // Twilio holds only the first "Yes."; the second never reached it.
    await smsSend.settleSendInFlight(conversation.id, {
      lookup: async () => [{ ...atTwilio(row, conversation.customer.phone, earlierSid), body: "Yes." }],
    });

    const settled = await prisma.message.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(settled.deliveryStatus, DeliveryStatus.FAILED);
    assert.equal(settled.twilioSid, null);
  });

  it("gives up on a Twilio lookup that does not answer in time, and keeps the thread held", async () => {
    const { conversation } = await unconfirmedSend(twoMinutes());
    const started = Date.now();

    const block = await smsSend.previewSendBlock(thread(conversation), undefined, {
      lookup: () => new Promise<TwilioMessage[]>(() => {}),
      lookupTimeoutMs: 50,
    });

    assert.ok(Date.now() - started < 2_000, "the page does not wait out a silent Twilio");
    assert.equal(block?.reason, "SEND_UNCONFIRMED");
    assert.equal((await outbound(conversation.id))[0].deliveryStatus, DeliveryStatus.SENDING);
    assert.equal(settlement.TWILIO_LOOKUP_TIMEOUT_MS, 5_000);
  });

  /** The thread as the customer's text left it: unread, last touched when they texted. */
  async function waitingOnUs(conversationId: string) {
    const text = await prisma.message.findFirstOrThrow({
      where: { conversationId, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: "desc" },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unread: true, lastMessageAt: text.createdAt },
    });
  }

  const threadState = (conversationId: string) =>
    prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { unread: true, lastMessageAt: true } });

  it("moves the thread on as the SENT write would have, when the reconciler settles a reply as sent", async () => {
    const { conversation, row } = await unconfirmedSend(settlement.SEND_GRACE_MS + 5_000);
    await waitingOnUs(conversation.id);

    await smsSend.settleSendInFlight(conversation.id, {
      lookup: async () => [atTwilio(row, conversation.customer.phone, `SMlate${suffix}${count}`)],
    });

    assert.deepEqual(await threadState(conversation.id), { unread: false, lastMessageAt: row.createdAt });
  });

  it("moves the thread on when Twilio's callback settles a reply Attend never recorded", async () => {
    const { conversation, row } = await unconfirmedSend(settlement.SEND_GRACE_MS + 5_000);
    await waitingOnUs(conversation.id);

    const url = smsSend.statusCallbackUrl(row.id) ?? "";
    assert.equal(await callback(url, { MessageSid: `SMcb${suffix}${count}`, MessageStatus: "delivered" }), "ok");

    assert.deepEqual(await threadState(conversation.id), { unread: false, lastMessageAt: row.createdAt });
  });

  it("leaves a thread a customer texted since the reply unread and in its place", async () => {
    const { conversation, row } = await unconfirmedSend(settlement.SEND_GRACE_MS + 5_000);
    const since = new Date(row.createdAt.getTime() + 10_000);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        body: "Thanks! Also, can you check the chain?",
        deliveryStatus: DeliveryStatus.RECEIVED,
        createdAt: since,
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { unread: true, lastMessageAt: since } });

    await smsSend.settleSendInFlight(conversation.id, {
      lookup: async () => [atTwilio(row, conversation.customer.phone, `SMnewer${suffix}${count}`)],
    });

    assert.equal((await outbound(conversation.id))[0].deliveryStatus, DeliveryStatus.SENT);
    assert.deepEqual(await threadState(conversation.id), { unread: true, lastMessageAt: since });
  });
});
