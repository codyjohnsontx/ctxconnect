-- 1. A text Attend has handed to Twilio and has not heard back about.
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'SENDING' BEFORE 'SENT';

-- 2. Orphans from before this state existed. All but the newest per thread are
--    closed as not delivered, with a message that says why; the newest becomes
--    SENDING so the reconciler asks Twilio about it.
UPDATE "Message" m
SET "deliveryStatus" = 'FAILED',
    "errorMessage" = 'Unconfirmed send from before Attend tracked sends in flight; superseded by a later attempt.'
WHERE m."direction" = 'OUTBOUND' AND m."deliveryStatus" = 'QUEUED' AND m."twilioSid" IS NULL
  AND EXISTS (
    SELECT 1 FROM "Message" newer
    WHERE newer."conversationId" = m."conversationId"
      AND newer."direction" = 'OUTBOUND' AND newer."deliveryStatus" = 'QUEUED' AND newer."twilioSid" IS NULL
      AND (newer."createdAt" > m."createdAt"
        OR (newer."createdAt" = m."createdAt" AND newer."id" > m."id"))
  );

UPDATE "Message"
SET "deliveryStatus" = 'SENDING'
WHERE "direction" = 'OUTBOUND' AND "deliveryStatus" = 'QUEUED' AND "twilioSid" IS NULL;

-- 3. One send in flight per thread, enforced where it cannot be forgotten
--    (same shape as 20260916090000_one_active_copy_of_an_alert). Prisma cannot
--    express a partial index, so it exists only here; the test asks the database.
CREATE UNIQUE INDEX "Message_one_send_in_flight_per_thread"
  ON "Message" ("conversationId")
  WHERE "deliveryStatus" = 'SENDING';
