import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import twilio from "twilio";
import {
  DeliveryStatus,
  Department,
  MessageDirection,
  NotificationStatus,
  NotificationType,
  Role,
} from "../src/generated/prisma/enums";
import type { AppUser } from "../src/lib/data";
import { activeNotificationsWhere } from "../src/lib/notification-facts";

// "New customer message" is the alert that says a customer is waiting on an
// answer. Opening an unread thread withdraws it, but a thread already on the
// advisor's screen when the text lands is never opened again before she
// answers it, so the alert outlived the reply and the rail filled with work
// already done. A reply recorded as sent now withdraws it, in the write that
// records it - see `replyResolvesNotificationTypes`.
//
// Driven end to end through the webhook's writer and the one send path, with
// Twilio faked. It writes, so it runs only when TEST_DATABASE_URL names a
// migrated, disposable database; CI's build job points it at its throwaway
// Postgres.
const databaseUrl = process.env.TEST_DATABASE_URL;

type Db = typeof import("../src/lib/prisma").prisma;
type SmsSend = typeof import("../src/lib/sms-send");
type Inbound = typeof import("../src/lib/inbound-text");
type StatusRoute = typeof import("../src/app/api/twilio/status/route");
type Settlement = typeof import("../src/lib/send-settlement");
type SmsTransport = import("../src/lib/sms-send").SmsTransport;

const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const AUTH_TOKEN = "test-auth-token-not-a-secret";
const APP_URL = "https://attend.example.test";

describe("a reply answers the new-message alert", { skip: !databaseUrl && "TEST_DATABASE_URL is not set" }, () => {
  let prisma: Db;
  let smsSend: SmsSend;
  let inbound: Inbound;
  let statusRoute: StatusRoute;
  let settlement: Settlement;
  let advisor: AppUser;
  let manager: AppUser;
  let count = 0;

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
    ({ prisma } = await import("../src/lib/prisma"));
    smsSend = await import("../src/lib/sms-send");
    inbound = await import("../src/lib/inbound-text");
    statusRoute = await import("../src/app/api/twilio/status/route");
    settlement = await import("../src/lib/send-settlement");

    advisor = await prisma.user.create({
      data: {
        name: `Reply answers ${suffix}`,
        email: `reply-answers-${suffix}@example.test`,
        passwordHash: "x",
        role: Role.SERVICE,
        department: Department.SERVICE,
      },
    });
    manager = await prisma.user.create({
      data: {
        name: `Reply answers manager ${suffix}`,
        email: `reply-answers-manager-${suffix}@example.test`,
        passwordHash: "x",
        role: Role.MANAGER,
      },
    });
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  /** A thread the advisor holds, with nothing on it yet. */
  async function heldThread() {
    count += 1;
    const phone = `+1888${suffix.slice(0, 4)}${String(count).padStart(3, "0")}`;
    const customer = await prisma.customer.create({ data: { name: `Reply answers ${suffix} ${count}`, phone } });

    return prisma.conversation.create({
      data: { customerId: customer.id, department: Department.SERVICE, assignedUserId: advisor.id },
      include: { customer: true },
    });
  }

  type Thread = Awaited<ReturnType<typeof heldThread>>;

  /** A text from the customer, written exactly as the inbound webhook writes one. */
  async function customerTexts(thread: Thread, body = "Is my bike ready?") {
    await prisma.$transaction((tx) =>
      inbound.recordInboundText(tx, {
        from: thread.customer.phone,
        body,
        twilioSid: `SMin${suffix}${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        mediaUrl: null,
        numMedia: 0,
      }),
    );
  }

  /** A thread whose customer is waiting on an answer. */
  async function waitingThread() {
    const thread = await heldThread();
    await customerTexts(thread);
    assert.equal(await standing(thread.id, advisor), 1, "the text raises the advisor's alert");

    return thread;
  }

  /** The advisor's reply, through the one send path, with Twilio played by `transport` - null is texting not connected. */
  const reply = (thread: Thread, transport: SmsTransport | null) =>
    smsSend.sendCustomerText({ userId: advisor.id, conversation: thread, body: "Yes, ready at 3." }, { transport });

  const sends = (sid: string) => async () => ({ sid });

  /** The thread's new-message alerts standing on this reader's rail - the rows its list shows and its badge counts. */
  const standing = (conversationId: string, reader: AppUser) =>
    prisma.notification.count({
      where: {
        AND: [activeNotificationsWhere(reader), { conversationId, type: NotificationType.NEW_INBOUND_MESSAGE }],
      },
    });

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
  }

  it("withdraws it from every rail when the reply is recorded as sent", async () => {
    const thread = await waitingThread();
    assert.equal(await standing(thread.id, manager), 1);

    const outcome = await reply(thread, sends(`SMok${suffix}${count}`));

    assert.equal(outcome.status, 200);
    assert.equal(await standing(thread.id, advisor), 0);
    assert.equal(await standing(thread.id, manager), 0);

    const [alert] = await prisma.notification.findMany({
      where: { conversationId: thread.id, type: NotificationType.NEW_INBOUND_MESSAGE },
    });
    assert.equal(alert.status, NotificationStatus.RESOLVED, "resolved, not deleted, like every other alert");
    assert.ok(alert.resolvedAt);
  });

  it("leaves it standing when Twilio refuses the reply", async () => {
    const thread = await waitingThread();

    const outcome = await reply(thread, async () => {
      throw Object.assign(new Error("[HTTP 400] Invalid 'To' phone number"), { status: 400 });
    });

    assert.equal(outcome.status, 502);
    assert.equal(await standing(thread.id, advisor), 1);
  });

  it("leaves it standing when texting is not connected", async () => {
    const thread = await waitingThread();

    const outcome = await reply(thread, null);

    assert.equal(outcome.status, 503);
    assert.equal(await standing(thread.id, advisor), 1);
  });

  it("leaves it standing while Twilio's answer is lost, and withdraws it when the callback settles the reply as sent", async () => {
    const thread = await waitingThread();
    let statusCallback = "";

    const lost = await reply(thread, async (message) => {
      statusCallback = message.statusCallback ?? "";
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    });

    assert.equal(lost.status, 500);
    assert.equal(await standing(thread.id, advisor), 1, "a reply that may still fail has answered nobody yet");

    await callback(statusCallback, { MessageSid: `SMcb${suffix}${count}`, MessageStatus: "sent" });

    assert.equal(await standing(thread.id, advisor), 0);
  });

  it("leaves it standing when the callback settles a lost reply as failed", async () => {
    const thread = await waitingThread();
    let statusCallback = "";

    await reply(thread, async (message) => {
      statusCallback = message.statusCallback ?? "";
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    });
    await callback(statusCallback, { MessageSid: `SMbad${suffix}${count}`, MessageStatus: "undelivered" });

    assert.equal(await standing(thread.id, advisor), 1);
  });

  it("withdraws it when the reconciler settles a lost reply as sent", async () => {
    const thread = await waitingThread();
    const lost = await reply(thread, async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    });
    // Past the grace period, so the reconciler asks Twilio about it.
    const row = await prisma.message.update({
      where: { id: String(lost.payload.messageId) },
      data: { createdAt: new Date(Date.now() - settlement.SEND_GRACE_MS - 5_000) },
    });
    // The customer's text has to come before the reply it is answered by.
    await prisma.message.updateMany({
      where: { conversationId: thread.id, direction: MessageDirection.INBOUND },
      data: { createdAt: new Date(row.createdAt.getTime() - 60_000) },
    });

    await smsSend.settleSendInFlight(thread.id, {
      lookup: async () => [
        {
          sid: `SMlate${suffix}${count}`,
          to: thread.customer.phone,
          body: row.body,
          direction: "outbound-api",
          dateCreated: row.createdAt,
        },
      ],
    });

    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: row.id } })).deliveryStatus, DeliveryStatus.SENT);
    assert.equal(await standing(thread.id, advisor), 0);
  });

  it("raises it again when the customer texts after the reply", async () => {
    const thread = await waitingThread();
    await reply(thread, sends(`SMfirst${suffix}${count}`));
    assert.equal(await standing(thread.id, advisor), 0);

    await customerTexts(thread, "Great, see you then. Can you check the chain too?");

    assert.equal(await standing(thread.id, advisor), 1);
    assert.equal(await standing(thread.id, manager), 1);
  });

  it("leaves standing a text that landed while the reply was on its way to Twilio", async () => {
    const thread = await waitingThread();

    const outcome = await reply(thread, async () => {
      // The reply is written; the customer's next text lands before Twilio's
      // answer does. The reply was not an answer to it.
      await customerTexts(thread, "Actually, can it be 4 instead?");
      return { sid: `SMrace${suffix}${count}` };
    });

    assert.equal(outcome.status, 200);
    // Each text keeps the row it raised; the rail collapses them to one alert.
    assert.ok((await standing(thread.id, advisor)) > 0, "the later text is still waiting on an answer");
  });

  it("leaves another thread's alert alone", async () => {
    const answered = await waitingThread();
    const other = await waitingThread();

    await reply(answered, sends(`SMone${suffix}${count}`));

    assert.equal(await standing(answered.id, advisor), 0);
    assert.equal(await standing(other.id, advisor), 1);
  });

  it("leaves the thread's other alerts, which a reply does not answer", async () => {
    const thread = await waitingThread();
    // A text that never went is still a failure to fix after the next one goes.
    await reply(thread, async () => {
      throw Object.assign(new Error("[HTTP 400] Invalid 'To' phone number"), { status: 400 });
    });

    await reply(thread, sends(`SMretry${suffix}${count}`));

    assert.equal(await standing(thread.id, advisor), 0);
    assert.equal(
      await prisma.notification.count({
        where: {
          conversationId: thread.id,
          type: NotificationType.MESSAGE_FAILED,
          status: { not: NotificationStatus.RESOLVED },
          // One copy per manager, and the test database holds other suites' managers too.
          recipientUserId: manager.id,
        },
      }),
      1,
    );
  });
});
