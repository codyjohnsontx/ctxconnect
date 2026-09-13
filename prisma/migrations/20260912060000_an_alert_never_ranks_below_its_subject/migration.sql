-- An alert's own rank is a floor under its subject's rank, never a replacement for it.
--
-- FOLLOW_UP_OVERDUE and MESSAGE_FAILED carry a rank of their own, HIGH, and it used to stand in
-- place of the follow-up's or the thread's. So an URGENT follow-up's alert read URGENT while it was
-- merely due and HIGH the moment it went late, and a reply that never reached the customer on an
-- URGENT thread read HIGH. Both now read URGENT. SLA_MISSED's own rank is URGENT, the top, so it
-- is unchanged either way.
--
-- New rows are written right, and a raise re-ranks every standing copy of the fact it raises. The
-- sweep raises FOLLOW_UP_OVERDUE for every open overdue follow-up on each Command Center load, so
-- those converge on the next load. What this buys is the rest: MESSAGE_FAILED copies for failed
-- texts older than the 25 the sweep reads, which no writer raises again, and resolved copies,
-- which the re-rank skips.
--
-- `<` compares the Priority enum in its declared order, LOW to URGENT, so a row is lifted only
-- where it stands below its subject and never lowered.

UPDATE "Notification" AS n
SET "priority" = t."priority"
FROM "Task" AS t
WHERE n."taskId" = t."id"
  AND n."type" = 'FOLLOW_UP_OVERDUE'
  AND n."priority" < t."priority";

UPDATE "Notification" AS n
SET "priority" = c."priority"
FROM "Conversation" AS c
WHERE n."conversationId" = c."id"
  AND n."type" = 'MESSAGE_FAILED'
  AND n."priority" < c."priority";

-- Not scoped by status, for the reason the unowned-thread migration before this one gives: the
-- subject's rank is the answer today and the rule says it was the floor when the row was written,
-- so there is no judgement in a resolved row to preserve.
