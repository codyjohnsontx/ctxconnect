# Decision: An Alert Ranks Where Its Subject Ranks

## Date

2026-09-12

## Status

Accepted

## Context

Two writers raise the unowned-thread alert: the Twilio inbound webhook, the
moment a text lands, and the operational sweep, on every Command Center load.
They agreed about what the alert was about and disagreed about how it ranked.
The sweep passed the thread's own priority. The webhook hard-coded
`Priority.HIGH`.

Nothing reconciled them, and the consequence is not a cosmetic sort order. The
alert rail reads a bounded number of rows in priority order and collapses them
to facts afterwards, so a row stored at the wrong rank travels through that list
at the wrong rank - high enough to take a slot in front of genuinely urgent
work, or low enough to fall off the end of it. Hiding a real alert behind a
scan full of wrong ones is the failure this whole area of the codebase exists to
prevent, and it has happened here once already during the coverage work.

Reproduced on a seeded dealership before anything was changed: a LOW service
thread, texted through the signed inbound webhook, was stored HIGH and listed
19th on the manager's rail among the HIGH block. Three sweeps in a row left it
there.

The diagnosis in the note on `createIfMissingWithClient` was close but not
right, and the running app settled it. The two writers do not collide on one
row at all. A thread alert keeps the text it was raised from
([2026-08-19](./2026-08-19-thread-alerts-keep-the-text-that-raised-them.md)), so
the webhook's row and the sweep's row are different rows, and both are written.
The read side collapses them to one fact, and the copy it shows is whichever the
priority-ordered scan reached first - the HIGH one. So it was never "first
writer wins"; it was "both writers write, and the wrong one is the one she
sees."

## Options Considered

1. **Make the webhook pass `conversation.priority`, like the sweep.** One line.
   The two writers then agree by convention.
2. **Reconcile the rank on the create-if-missing path**, so a differing rank on
   a standing row is corrected rather than returned as-is.
3. **Take the rank away from writers entirely.** A writer supplies the priority
   of the thread or follow-up the alert is about - a fact about the dealership -
   and one rule turns that into the alert's rank.
4. **Both 2 and 3.**

## Decision

Option 4.

## Reasoning

Option 1 is the change the defect asks for and the one this repository has
already rejected in principle. The 2026-08-19 decision put it plainly: two
writers free to invent their own shape will invent a third. Convention is what
produced this, and a one-line fix leaves the next writer free to hard-code a
rank again with nothing to stop them.

Option 3 makes that particular mistake unavailable. `priority` is gone from what
a writer may pass; `subjectPriority` replaces it, and
`notificationPriority(type, subjectPriority)` decides the rank. A writer can no
longer hold an opinion about how an alert ranks, only report how the thing it is
about is ranked, and both writers of an unowned thread have the same
conversation in hand. The cost is that every alert writer had to change, which
is the point of it rather than a side effect.

Option 3 alone is not enough, because agreement at write time is not the same as
staying right afterwards. A thread escalated an hour after its alert was raised
would keep the old rank: the sweep finds the standing row and used to return it
untouched, and the webhook's copy is never revisited at all, because the text it
was raised from will not arrive again. That is the same "nobody corrects it"
shape one step later, so option 2 comes with it - and it is corrected across
every standing copy of the fact rather than on the row the call happened to
match, since a per-text copy has no writer of its own.

The reconcile is cheap rather than churn: because the rank is derived, every
writer of one fact computes the same value, so the update matches no rows unless
the thread or follow-up has genuinely been re-ranked since.

## Tradeoffs

- **The rail's ordering changes, and that is the visible point of the work.**
  An unowned LOW thread now sorts below a NORMAL one instead of above it. The
  2026-08-19 work was forbidden from making this change and filed it; this is
  the change being made deliberately and on its own terms.
- **The seeded demo dataset moves with it, in two places.** The seed's
  unassigned sales lead was written HIGH by hand over a NORMAL conversation and
  now reads NORMAL. The sales advisor's "New customer message" alert on the
  Panigale thread was written HIGH over an URGENT conversation and now reads
  URGENT. Both are the seed telling the truth about its own data rather than a
  regression, and between them the demo rail is ordered differently, so it is
  worth seeing before the next demo.
- **Three ranks stay the alert's own rather than the thread's.** A missed
  response clock is URGENT, a text that never reached the customer is HIGH and a
  follow-up past its time is HIGH, whatever the thread behind them was ranked
  at, because the event is the severity. That is a judgement, and it is pinned in
  `tests/notification-priority.test.ts` so a new alert type has to be sorted
  rather than defaulting into inheritance.
- **A fixed rank replaces the subject's rather than setting a floor under it**,
  which cuts both ways. It lifts a quiet subject's alert, which is the point of
  it, and it also lowers a loud one: an URGENT follow-up's alert reads URGENT
  while it is merely due and drops to HIGH the moment it goes late. That is the
  behaviour as it stood before this change, carried across unchanged and now
  pinned in both directions rather than left to be discovered. Whether the drop
  is right is a product question and is filed on its own.
- **The re-rank reaches a fact only when a writer raises it again**, and only
  over rows that are not resolved, because it lives on the create-if-missing
  path. The sweep re-raises `UNASSIGNED_CONVERSATION`, `FOLLOW_UP_DUE` and
  `FOLLOW_UP_OVERDUE` on every Command Center load, so those converge.
  `NEW_INBOUND_MESSAGE`, `CONVERSATION_ASSIGNED` and `CONVERSATION_REASSIGNED`
  have no such writer, and `updateConversation` raises nothing on a priority
  edit, so one of those standing on a thread re-ranked afterwards keeps its old
  rank. Putting the re-rank where a thread's priority is edited would close it
  and is a write path this change deliberately does not add.
- **The guard against a new writer is textual.** A scan over the alert writers
  fails on a rank handed in as a constant. It matches the code as written today
  and a sufficiently indirect writer would slip past, the same best-effort bar
  the existing write-shape scan sets.
- **One extra statement per raise.** An `updateMany` that usually matches
  nothing, on paths that already do several writes. Measured against the
  alternative - a rank nobody can correct - it is worth it.
- **A one-off migration for the rows the sweep will not reach.** On a thread
  that is still unassigned and open, the next Command Center load re-ranks the
  webhook's standing copy on its own, so the migration is not what fixes those.
  What it buys is the window before that load, and the rows the sweep's scope
  never covers: threads assigned or closed since the row was written, which it
  no longer queries, and resolved copies, which the re-rank skips. It is not
  scoped by status, because the thread's priority is the answer today and was
  the answer when the row was written, so there is no judgement to preserve in a
  resolved row. Nothing revives a resolved row of this type today
  (`reopenConversationNotifications` is only ever called with
  `readResolvesNotificationTypes`, which is `NEW_INBOUND_MESSAGE` alone), so that
  half corrects the record rather than the rail.

## Portfolio Notes

The interesting part was refusing to fix the bug as it was described. The note
in the code named a mechanism - one row, first writer wins - and the running app
showed a different one: two rows, both written, and the reader shown the wrong
one by a scan that orders before it collapses. The one-line fix would have made
the reproduction pass and left the shape that produced it, plus a second
instance of it standing in the seed.

What the fix actually removes is a category of field: a writer's opinion about
something that belongs to the fact. Wording stays the writer's, because the
webhook can quote the text that just landed and the sweep genuinely cannot. Rank
is not an opinion, so it stopped being an argument.

Related: [thread alerts keep the text that raised them](./2026-08-19-thread-alerts-keep-the-text-that-raised-them.md),
[PRD - One Alert Per Thing That Needs Doing](../prds/2026-08-17-one-alert-per-thing-that-needs-doing.md).
