-- Deactivation now ends the session on every device and leaves evidence an admin can read.
-- Both columns are nullable with no backfill: accounts deactivated before this migration have
-- no recorded cutoff, and no account has been seen on a request yet.
ALTER TABLE "User" ADD COLUMN "accessEndedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
