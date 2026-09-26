-- Consent becomes a ledger, not a flag.
--
-- Until now a Customer carried `smsOptedIn` (default true) and `smsOptedOut`, so any row created
-- by any path was consented at birth with no evidence at all. This replaces them with an
-- append-only `ConsentEvent` ledger and a cached `smsConsent` status that defaults to NONE: a
-- customer is textable only when an event says why. The derivation lives in src/lib/consent.ts.
--
-- Every existing row is backfilled from evidence Attend already holds - the customer's own
-- texts - so nobody who texted in loses the ability to be answered, and nobody who opted out
-- gains it back.
--
-- One explicit transaction (Prisma does not wrap a PostgreSQL migration in one), with the tables
-- the backfill reads locked against writes, so a STOP landing mid-migration cannot fall between
-- the backfill reading the texts and the old flags being dropped.

BEGIN;

LOCK TABLE "Customer", "Message", "OptInEvent" IN SHARE ROW EXCLUSIVE MODE;

-- CreateEnum
CREATE TYPE "SmsConsentStatus" AS ENUM ('NONE', 'GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('SMS');

-- CreateEnum
CREATE TYPE "ConsentEventKind" AS ENUM ('GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('CUSTOMER_TEXTED_FIRST', 'KEYWORD_START', 'KEYWORD_STOP', 'STAFF_RECORDED_REQUEST', 'VERBAL_AT_COUNTER', 'WRITTEN_FORM', 'PROVIDER_BLOCK', 'STAFF_CORRECTION', 'BACKFILL_FIRST_INBOUND', 'BACKFILL_LEGACY_FLAG', 'SEED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "smsConsent" "SmsConsentStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "smsConsentEventId" TEXT;

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "channel" "ConsentChannel" NOT NULL DEFAULT 'SMS',
    "kind" "ConsentEventKind" NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "messageId" TEXT,
    "recordedByUserId" TEXT,
    "evidence" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerRef" TEXT,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentEvent_customerId_occurredAt_idx" ON "ConsentEvent"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "ConsentEvent_phone_occurredAt_idx" ON "ConsentEvent"("phone", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_smsConsentEventId_key" ON "Customer"("smsConsentEventId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_smsConsentEventId_fkey" FOREIGN KEY ("smsConsentEventId") REFERENCES "ConsentEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What Prisma's schema language cannot say, and so exists only here (like the partial index in
-- 20260916090000_one_active_copy_of_an_alert). `consentMethodRules` in src/lib/consent.ts is the
-- same table in code; tests/consent.test.ts reads this file and fails if the two disagree.
--
-- Which kinds each method may record.
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_method_kind_check" CHECK (
  CASE "method"
    WHEN 'CUSTOMER_TEXTED_FIRST' THEN "kind" = 'GRANTED'
    WHEN 'KEYWORD_START' THEN "kind" = 'GRANTED'
    WHEN 'KEYWORD_STOP' THEN "kind" = 'REVOKED'
    WHEN 'STAFF_RECORDED_REQUEST' THEN "kind" = 'REVOKED'
    WHEN 'VERBAL_AT_COUNTER' THEN "kind" = 'GRANTED'
    WHEN 'WRITTEN_FORM' THEN "kind" = 'GRANTED'
    WHEN 'PROVIDER_BLOCK' THEN "kind" = 'REVOKED'
    WHEN 'STAFF_CORRECTION' THEN true
    WHEN 'BACKFILL_FIRST_INBOUND' THEN "kind" = 'GRANTED'
    WHEN 'BACKFILL_LEGACY_FLAG' THEN "kind" = 'REVOKED'
    WHEN 'SEED' THEN true
  END
);

-- A person vouching for consent has to be named and has to say what the customer said or
-- signed. The recorder's foreign key is RESTRICT rather than SET NULL for the same reason:
-- nulling it would break this check, and the account is evidence.
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_staff_evidence_check" CHECK (
  "method" NOT IN ('STAFF_RECORDED_REQUEST', 'VERBAL_AT_COUNTER', 'WRITTEN_FORM', 'STAFF_CORRECTION')
  OR ("recordedByUserId" IS NOT NULL AND "evidence" IS NOT NULL AND btrim("evidence") <> '')
);

-- Backfill. Every inbound text is classified by the rule in src/lib/consent.ts
-- (`normalizeConsentReply` and the keyword lists), restated in SQL: trim, upper-case, fold runs
-- of spaces, hyphens and underscores, drop trailing punctuation, match the whole message. That
-- is wider than the list the webhook used until now, so a customer who texted "REVOKE", "OPT
-- OUT" or "Stop." comes out opted out. That tightens, and it is what the FCC's per se list says.
CREATE TEMPORARY TABLE consent_inbound AS
SELECT
  m.id AS message_id,
  m."createdAt" AS occurred_at,
  c."customerId" AS customer_id,
  row_number() OVER (PARTITION BY c."customerId" ORDER BY m."createdAt", m.id) AS nth,
  CASE
    WHEN n.word IN ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT OUT') THEN 'REVOKE'
    WHEN n.word IN ('START', 'UNSTOP') THEN 'GRANT'
    WHEN n.word = 'YES' THEN 'YES'
    ELSE 'NONE'
  END AS keyword
FROM "Message" m
JOIN "Conversation" c ON c.id = m."conversationId"
CROSS JOIN LATERAL (
  SELECT btrim(regexp_replace(regexp_replace(upper(btrim(m.body)), '[\s_-]+', ' ', 'g'), '[\s.,!?;:''"]+$', '')) AS word
) n
WHERE m.direction = 'INBOUND';

-- 1. The customer's first text is the customer texting first, unless that text was itself a
--    keyword: a first-ever STOP grants nothing, and a first-ever START is recorded as START.
INSERT INTO "ConsentEvent" ("id", "customerId", "phone", "kind", "method", "messageId", "occurredAt")
SELECT 'bf' || replace(gen_random_uuid()::text, '-', ''), i.customer_id, cu.phone, 'GRANTED', 'BACKFILL_FIRST_INBOUND', i.message_id, i.occurred_at
FROM consent_inbound i
JOIN "Customer" cu ON cu.id = i.customer_id
WHERE i.nth = 1 AND i.keyword IN ('NONE', 'YES');

-- 2. Every stop word and every START or UNSTOP, with the text as evidence. YES counts only as a
--    re-subscribe after a stop word, exactly as the webhook now reads it.
INSERT INTO "ConsentEvent" ("id", "customerId", "phone", "kind", "method", "messageId", "occurredAt")
SELECT
  'bf' || replace(gen_random_uuid()::text, '-', ''),
  i.customer_id,
  cu.phone,
  (CASE WHEN i.keyword = 'REVOKE' THEN 'REVOKED' ELSE 'GRANTED' END)::"ConsentEventKind",
  (CASE WHEN i.keyword = 'REVOKE' THEN 'KEYWORD_STOP' ELSE 'KEYWORD_START' END)::"ConsentMethod",
  i.message_id,
  i.occurred_at
FROM consent_inbound i
JOIN "Customer" cu ON cu.id = i.customer_id
WHERE i.keyword IN ('REVOKE', 'GRANT')
   OR (
     i.keyword = 'YES'
     AND i.nth > 1
     AND (
       SELECT prior.keyword
       FROM consent_inbound prior
       WHERE prior.customer_id = i.customer_id
         AND prior.nth < i.nth
         AND prior.keyword IN ('REVOKE', 'GRANT', 'YES')
       ORDER BY prior.nth DESC
       LIMIT 1
     ) = 'REVOKE'
   );

-- 3. OptInEvent rows the texts above do not already carry. Rows the webhook wrote name the text
--    they came from, so they are reproduced by step 2 while that text exists; one whose text is
--    gone is kept, saying so. Rows the demo seed wrote name no text and become SEED.
INSERT INTO "ConsentEvent" ("id", "customerId", "phone", "kind", "method", "evidence", "occurredAt")
SELECT
  'bf' || replace(gen_random_uuid()::text, '-', ''),
  o."customerId",
  cu.phone,
  (CASE WHEN o.type = 'OPT_OUT' THEN 'REVOKED' ELSE 'GRANTED' END)::"ConsentEventKind",
  (CASE
    WHEN o.source <> 'twilio' THEN 'SEED'
    WHEN o.type = 'OPT_OUT' THEN 'KEYWORD_STOP'
    ELSE 'KEYWORD_START'
  END)::"ConsentMethod",
  'OptInEvent ' || o.id || ' (source ' || o.source || ', message ' || coalesce(o."messageId", 'none') || ')',
  o."createdAt"
FROM "OptInEvent" o
JOIN "Customer" cu ON cu.id = o."customerId"
WHERE o.source <> 'twilio'
   OR o."messageId" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "Message" m WHERE m.id = o."messageId");

-- The ledger's own answer per customer: latest occurredAt, then createdAt, then id - the order
-- `consentState` uses.
CREATE TEMPORARY TABLE consent_latest AS
SELECT DISTINCT ON (e."customerId") e."customerId" AS customer_id, e.id AS event_id, e.kind, e."occurredAt" AS occurred_at
FROM "ConsentEvent" e
ORDER BY e."customerId", e."occurredAt" DESC, e."createdAt" DESC, e.id DESC;

-- 4. A customer the old flag says is opted out stays opted out, whatever the texts say. Both old
--    writers flipped the flag and wrote an event together, so this should find nobody; it exists
--    so that an opt-out cannot be lost by a backfill. The event is dated no earlier than the
--    ledger's latest, because it has to be the record's last word; the flag's own time is kept
--    in the evidence.
INSERT INTO "ConsentEvent" ("id", "customerId", "phone", "kind", "method", "evidence", "occurredAt")
SELECT
  'bf' || replace(gen_random_uuid()::text, '-', ''),
  cu.id,
  cu.phone,
  'REVOKED',
  'BACKFILL_LEGACY_FLAG',
  'smsOptedOut=true, smsOptedIn=' || cu."smsOptedIn" || ', optedOutAt=' || coalesce(to_char(cu."optedOutAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'none'),
  greatest(coalesce(cu."optedOutAt", cu."updatedAt"), l.occurred_at + interval '1 millisecond')
FROM "Customer" cu
LEFT JOIN consent_latest l ON l.customer_id = cu.id
WHERE cu."smsOptedOut" AND (l.kind IS NULL OR l.kind <> 'REVOKED');

-- 5. The cache, from the same ordering. A customer with no event stays NONE.
UPDATE "Customer" cu
SET "smsConsent" = (CASE WHEN latest.kind = 'GRANTED' THEN 'GRANTED' ELSE 'REVOKED' END)::"SmsConsentStatus",
    "smsConsentEventId" = latest.id
FROM (
  SELECT DISTINCT ON (e."customerId") e."customerId", e.id, e.kind
  FROM "ConsentEvent" e
  ORDER BY e."customerId", e."occurredAt" DESC, e."createdAt" DESC, e.id DESC
) latest
WHERE latest."customerId" = cu.id;

-- 6. The flags and the old table go.
DROP TABLE consent_inbound;
DROP TABLE consent_latest;

-- DropForeignKey
ALTER TABLE "OptInEvent" DROP CONSTRAINT "OptInEvent_customerId_fkey";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "optedInAt",
DROP COLUMN "optedOutAt",
DROP COLUMN "smsOptedIn",
DROP COLUMN "smsOptedOut";

-- DropTable
DROP TABLE "OptInEvent";

-- DropEnum
DROP TYPE "OptInEventType";

COMMIT;
