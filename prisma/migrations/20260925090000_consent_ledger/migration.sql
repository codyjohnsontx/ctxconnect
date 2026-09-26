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
-- same table in code; tests/consent-cache.test.ts asks the database and fails if the two disagree.
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

-- The ledger is never rewritten: a correction is a new event, so the database refuses UPDATE
-- and DELETE. The one update it lets through is the one Postgres makes itself when an
-- evidencing text is deleted - the ON DELETE SET NULL above clearing `messageId` and nothing
-- else.
CREATE FUNCTION consent_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."messageId" IS NOT NULL
    AND NEW."messageId" IS NULL
    AND to_jsonb(NEW) - 'messageId' = to_jsonb(OLD) - 'messageId'
    AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m.id = OLD."messageId")
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'ConsentEvent is append-only: % of % refused', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ConsentEvent_append_only"
BEFORE UPDATE OR DELETE ON "ConsentEvent"
FOR EACH ROW EXECUTE FUNCTION consent_event_append_only();

-- TRUNCATE fires no row trigger, and a TRUNCATE of "Customer" CASCADE reaches this table too, so
-- it gets a statement trigger of its own that always refuses. Dropping the schema, which is what
-- `prisma migrate reset` does, fires neither.
CREATE FUNCTION consent_event_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ConsentEvent is append-only: TRUNCATE refused'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ConsentEvent_no_truncate"
BEFORE TRUNCATE ON "ConsentEvent"
FOR EACH STATEMENT EXECUTE FUNCTION consent_event_no_truncate();

-- `classifyConsentReply` in src/lib/consent.ts, restated in SQL so the backfill reads a text
-- exactly as the webhook does; tests/consent-cache.test.ts runs both over the same texts. Trim,
-- upper-case, fold runs of spaces, hyphens and underscores, drop trailing punctuation and match
-- the whole message against the keywords; failing that, look for a review word or phrase
-- anywhere in it. That is wider than the list the webhook used until now, so a customer who
-- texted "REVOKE", "OPT OUT" or "Stop." comes out opted out. That tightens, and it is what the
-- FCC's per se list says.
CREATE FUNCTION consent_classify_reply(body text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN n.word IN ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT OUT') THEN 'REVOKE'
    WHEN n.word IN ('START', 'UNSTOP') THEN 'GRANT'
    WHEN n.word = 'YES' THEN 'YES'
    WHEN EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'STOP', 'STOPALL', 'UNSUBSCRIBE', 'REVOKE', 'OPTOUT', 'OPT OUT',
        'DONT TEXT', 'DON''T TEXT', 'DO NOT TEXT', 'NO MORE TEXTS', 'REMOVE ME', 'TAKE ME OFF', 'WRONG NUMBER'
      ]) AS review(phrase)
      WHERE position(
        ' ' || review.phrase || ' ' IN
        ' ' || regexp_replace(
          regexp_replace(
            regexp_replace(
              replace(n.word, '’', ''''),
              '(?<![A-Z0-9''])(?:STOP BY|STOP IN|STOP AT|STOP OVER|WON''T STOP|WONT STOP|WILL NOT STOP)(?![A-Z0-9''])', '_', 'g'
            ),
            '[^A-Z0-9''_ ]+', ' ', 'g'
          ),
          ' +', ' ', 'g'
        ) || ' '
      ) > 0
    ) THEN 'REVIEW'
    ELSE 'NONE'
  END
  FROM (
    SELECT btrim(regexp_replace(regexp_replace(upper(regexp_replace(coalesce(body, ''), '[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', ' ', 'g')), '[\s_-]+', ' ', 'g'), '[\s.,!?;:''"]+$', '')) AS word
  ) n
$$;

-- Backfill. Every inbound text is classified by that function.
--
-- Texts are put in the order the customer sent them: by their time, then - for two texts in
-- the same millisecond - by when the old webhook recorded the opt-in or opt-out each one caused
-- (`OptInEvent.createdAt`, which says which of a same-millisecond STOP and START it handled
-- last). The old webhook wrote a text and its record in one transaction, so both can tie too;
-- then the customer's final legacy flags decide, putting the keyword that matches where the
-- customer ended up last, and only then the id. `nth` is that order, and every event below
-- carries it through to its id, so no tie is ever left to chance.
CREATE TEMPORARY TABLE consent_inbound AS
SELECT
  t.message_id,
  t.occurred_at,
  t.legacy_at,
  t.customer_id,
  row_number() OVER (
    PARTITION BY t.customer_id
    ORDER BY
      t.occurred_at,
      t.legacy_at,
      CASE
        WHEN t.keyword IN ('GRANT', 'YES') THEN CASE WHEN t.opted_out THEN 0 ELSE 1 END
        WHEN t.keyword = 'REVOKE' THEN CASE WHEN t.opted_out THEN 1 ELSE 0 END
        ELSE 0
      END,
      t.message_id
  ) AS nth,
  t.keyword
FROM (
  SELECT
    m.id AS message_id,
    m."createdAt" AS occurred_at,
    coalesce(legacy.recorded_at, m."createdAt") AS legacy_at,
    c."customerId" AS customer_id,
    cu."smsOptedOut" AS opted_out,
    consent_classify_reply(m.body) AS keyword
  FROM "Message" m
  JOIN "Conversation" c ON c.id = m."conversationId"
  JOIN "Customer" cu ON cu.id = c."customerId"
  LEFT JOIN LATERAL (
    SELECT min(o."createdAt") AS recorded_at FROM "OptInEvent" o WHERE o."messageId" = m.id
  ) legacy ON true
  WHERE m.direction = 'INBOUND'
) t;

-- Steps 1 to 3 collect the events here, with the order each takes among events at the same
-- occurredAt, and are written together once they are all known.
CREATE TEMPORARY TABLE consent_backfill (
  customer_id TEXT NOT NULL,
  kind "ConsentEventKind" NOT NULL,
  method "ConsentMethod" NOT NULL,
  message_id TEXT,
  evidence TEXT,
  occurred_at TIMESTAMP(3) NOT NULL,
  tie_at TIMESTAMP(3) NOT NULL,
  tie_ref TEXT NOT NULL
);

-- 1. The customer's first text is the customer texting first, as the webhook reads it. A
--    possible stop request in other words is not consent and is passed over; the first text
--    after it decides. If that text is itself a keyword it grants nothing here: a first-ever STOP
--    is recorded as STOP, a first-ever START as START. A customer who only ever sent possible
--    stop requests stays NONE.
INSERT INTO consent_backfill (customer_id, kind, method, message_id, occurred_at, tie_at, tie_ref)
SELECT i.customer_id, 'GRANTED', 'BACKFILL_FIRST_INBOUND', i.message_id, i.occurred_at, i.legacy_at, 'm' || lpad(i.nth::text, 12, '0')
FROM (
  SELECT DISTINCT ON (customer_id) *
  FROM consent_inbound
  WHERE keyword <> 'REVIEW'
  ORDER BY customer_id, nth
) i
WHERE i.keyword IN ('NONE', 'YES');

-- 2. Every stop word and every START or UNSTOP, with the text as evidence. YES counts only as a
--    re-subscribe after a stop word, exactly as the webhook now reads it.
INSERT INTO consent_backfill (customer_id, kind, method, message_id, occurred_at, tie_at, tie_ref)
SELECT
  i.customer_id,
  (CASE WHEN i.keyword = 'REVOKE' THEN 'REVOKED' ELSE 'GRANTED' END)::"ConsentEventKind",
  (CASE WHEN i.keyword = 'REVOKE' THEN 'KEYWORD_STOP' ELSE 'KEYWORD_START' END)::"ConsentMethod",
  i.message_id,
  i.occurred_at,
  i.legacy_at,
  'm' || lpad(i.nth::text, 12, '0')
FROM consent_inbound i
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
INSERT INTO consent_backfill (customer_id, kind, method, evidence, occurred_at, tie_at, tie_ref)
SELECT
  o."customerId",
  (CASE WHEN o.type = 'OPT_OUT' THEN 'REVOKED' ELSE 'GRANTED' END)::"ConsentEventKind",
  (CASE
    WHEN o.source <> 'twilio' THEN 'SEED'
    WHEN o.type = 'OPT_OUT' THEN 'KEYWORD_STOP'
    ELSE 'KEYWORD_START'
  END)::"ConsentMethod",
  'OptInEvent ' || o.id || ' (source ' || o.source || ', message ' || coalesce(o."messageId", 'none') || ')',
  o."createdAt",
  o."createdAt",
  'o' || o.id
FROM "OptInEvent" o
WHERE o.source <> 'twilio'
   OR o."messageId" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "Message" m WHERE m.id = o."messageId");

-- Written in one statement, so every row shares the transaction's createdAt and the id alone
-- breaks a tie at the same occurredAt, exactly as `consentState` breaks it. The ids are numbered
-- in the order worked out above, so the later of two same-millisecond events has the larger id.
INSERT INTO "ConsentEvent" ("id", "customerId", "phone", "kind", "method", "messageId", "evidence", "occurredAt")
SELECT
  'bf' || lpad(row_number() OVER (ORDER BY b.customer_id, b.occurred_at, b.tie_at, b.tie_ref)::text, 12, '0'),
  b.customer_id,
  cu.phone,
  b.kind,
  b.method,
  b.message_id,
  b.evidence,
  b.occurred_at
FROM consent_backfill b
JOIN "Customer" cu ON cu.id = b.customer_id;

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
  'bl' || cu.id,
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
DROP TABLE consent_backfill;
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
