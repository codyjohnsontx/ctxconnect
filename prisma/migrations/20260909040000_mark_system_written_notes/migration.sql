-- A note Attend writes itself is bookkeeping, not somebody attending to the customer.
--
-- The breach rule treats a thread as attended when anything follows the customer's last text.
-- That is right for a reply, and right for an advisor's own note - "called her, left a voicemail"
-- is real work and should quiet the alert. It is wrong for the notes Attend writes on its own
-- behalf when a conversation changes hands: reassignment and coverage move a thread without
-- anybody answering the customer, and the alert saying they are still waiting was being
-- withdrawn by the very act of handing the thread on.
--
-- The distinction is not reply-versus-note. It is a person recording action versus the system
-- recording an event, and only a mark on the row can carry it.

ALTER TABLE "Message" ADD COLUMN "systemGenerated" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows are deliberately left false, which reads them all as written by a person.
--
-- This is a judgement, not an accident of the default. Attend cannot tell, after the fact, which
-- historical internal notes it wrote itself - the marker is what would have said so. Marking them
-- all as system-written would retroactively reopen breach alerts on months of settled threads and
-- flood the board with history nobody can act on; leaving them as they are keeps today's
-- behaviour for old data and applies the new rule from here forward, where the mark is truthful.
