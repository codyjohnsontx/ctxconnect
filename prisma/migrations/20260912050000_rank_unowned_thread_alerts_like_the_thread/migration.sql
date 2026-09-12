-- An unowned-thread alert ranks where its thread ranks.
--
-- Two writers raise UNASSIGNED_CONVERSATION: the Twilio inbound webhook the moment a text lands,
-- and the operational sweep on every Command Center load. The sweep passed the thread's own
-- priority; the webhook hard-coded HIGH. So a LOW thread whose text arrived at the webhook was
-- stored HIGH, and nothing ever corrected it - the sweep's row is a different row, because a
-- thread alert keeps the text it was raised from, and the rail collapses the two to one fact only
-- after reading rows in priority order. The HIGH copy is the one it shows, and it sits ahead of
-- every genuinely-NORMAL alert in a list that stops at a fixed number of rows.
--
-- The writers now agree, so no new row can be stored this way. Rows already written cannot correct
-- themselves: the webhook will not fire again for a text it has already recorded, so nothing
-- revisits them. This is that one-off correction.

UPDATE "Notification" AS n
SET "priority" = c."priority"
FROM "Conversation" AS c
WHERE n."conversationId" = c."id"
  AND n."type" = 'UNASSIGNED_CONVERSATION'
  AND n."priority" <> c."priority";

-- Resolved rows are corrected too, deliberately. Marking a thread unread revives its resolved
-- alerts (`reopenConversationNotifications`), so a wrong rank left in a resolved row comes back to
-- the rail later. Unlike the system-note migration beside this one, there is no judgement to
-- preserve here: the thread's priority is the answer today and was the answer when the row was
-- written, so every row is being set to the value its writer should have used.
