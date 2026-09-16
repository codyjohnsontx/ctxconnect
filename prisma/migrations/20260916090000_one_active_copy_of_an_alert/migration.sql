-- One recipient holds at most one active copy of an alert.
--
-- The operational sweep runs on every Command Center load and raised an alert by looking for it
-- and creating it when it was missing, with nothing in the database refusing a second copy. Two or
-- three loads landing together each found it missing and each wrote it: three concurrent loads left
-- three active copies per person. No list repeats them - every list collapses copies of one fact -
-- but a list reads a fixed number of rows before collapsing, so the copies crowd genuine alerts off
-- the end of it while the badge, which counts facts, still counts them.
--
-- A check-then-act race is not closed by checking harder, so the database refuses the copy. The
-- key is exactly the columns the writer has always matched an existing alert on
-- (`createIfMissingWithClient` in src/lib/notifications.ts): the type, the recipient, the thread,
-- the follow-up and the message. Only active rows are covered. A resolved row is the record that an
-- alert was raised and dealt with, and one fact legitimately collects several of those over its life.
--
-- The columns are nullable and Postgres treats NULLs as distinct in a unique index, which would let
-- every copy of a thread alert (no follow-up) through. COALESCE to '' closes that on any Postgres
-- version; no id this app writes is empty. Prisma's schema language cannot express an expression or
-- partial index, so this index lives here only - see the note on `model Notification`.
--
-- The table is locked against writes for the length of this migration, so a sweep landing between
-- the cleanup and the index cannot write a copy that makes the index fail to build.

BEGIN;

LOCK TABLE "Notification" IN SHARE ROW EXCLUSIVE MODE;

-- Cleanup of the copies that already stand. Scoped to ACTIVE rows (UNREAD or READ) that share every
-- key column with another active row - rows the writer itself already treats as the same alert,
-- since its lookup would have returned any one of them. Nothing is deleted: the extra copies are
-- RESOLVED, the same withdrawal every other path in the app uses, and they keep their id, wording
-- and createdAt. They are recognisable afterwards by the `resolvedAt` this statement stamps, which is
-- one transaction timestamp shared by all of them.
--
-- The copy kept per key is deterministic: an UNREAD copy before a READ one, because the reader has
-- not dealt with it; then the newest, which is the copy a list already shows; then the highest id.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY
        "type",
        COALESCE("recipientUserId", ''),
        COALESCE("conversationId", ''),
        COALESCE("taskId", ''),
        COALESCE("messageId", '')
      ORDER BY ("status" = 'UNREAD') DESC, "createdAt" DESC, "id" DESC
    ) AS copy
  FROM "Notification"
  WHERE "status" <> 'RESOLVED'
)
UPDATE "Notification" AS n
SET "status" = 'RESOLVED', "resolvedAt" = now(), "updatedAt" = now()
FROM ranked
WHERE n."id" = ranked."id"
  AND ranked.copy > 1;

CREATE UNIQUE INDEX "Notification_one_active_copy_key" ON "Notification" (
  "type",
  COALESCE("recipientUserId", ''),
  COALESCE("conversationId", ''),
  COALESCE("taskId", ''),
  COALESCE("messageId", '')
)
WHERE "status" <> 'RESOLVED';

COMMIT;
