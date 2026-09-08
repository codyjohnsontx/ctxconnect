-- Coverage: an advisor's open conversations can be held by another active advisor while she is
-- away, and handed back when she returns. Nothing is backfilled - before this migration nobody
-- was covering anyone, which is exactly what NULL in all three columns says.

-- Who is holding this account's open conversations, and from when. `coveredSince` is the instant
-- the return rule measures a reply against, so the pair is written together or not at all.
ALTER TABLE "User" ADD COLUMN "coveredByUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "coveredSince" TIMESTAMP(3);

-- The advisor a thread goes back to. Set only by coverage that can end; a permanent hand-off
-- moves the assignee and leaves this NULL, because there is nobody for it to go back to.
ALTER TABLE "Conversation" ADD COLUMN "coveredForUserId" TEXT;

CREATE INDEX "Conversation_coveredForUserId_idx" ON "Conversation"("coveredForUserId");

ALTER TABLE "User" ADD CONSTRAINT "User_coveredByUserId_fkey" FOREIGN KEY ("coveredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_coveredForUserId_fkey" FOREIGN KEY ("coveredForUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
