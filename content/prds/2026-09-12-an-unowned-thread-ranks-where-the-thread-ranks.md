# PRD: An Unowned Thread Ranks Where The Thread Ranks

## Status

Built

## Date

2026-09-12

## Summary

An unowned conversation raises an alert on the manager's rail. That alert was
being stored at `HIGH` whenever the customer's text arrived through the Twilio
webhook, whatever the conversation itself was ranked at, and nothing ever
corrected it. The alert now carries the thread's own rank, and the next raise of
that alert brings every standing copy of it up to date.

## Problem

The rail shows a bounded number of alerts, ordered by priority. A quiet thread
wearing a `HIGH` badge takes a slot in front of work that genuinely needs
answering first, and the manager has no way to tell it apart from a real one -
the badge is the only thing on the row that says how urgent it is, and it was
lying.

The same mechanism has hidden a real alert here once before, during the coverage
work, so this is a suppression risk rather than an ordering annoyance.

## Target User

The manager or GM reading the alert rail and the Command Center, deciding what
to pick up next. Service advisors see it too, on threads tagged to their
department.

## Goal

An alert's badge tells the truth about the work behind it, so the order of the
rail can be trusted.

## v1 Scope

- An alert's rank is derived from the alert type plus the priority of the thread
  or follow-up it is about, in one rule every writer reads.
- When a writer raises a fact again, every standing copy of that fact is
  re-ranked rather than only the row the raise matched. That is what reaches the
  webhook's per-text copy, which has no writer of its own to revisit it.
- A one-off correction of the rows already stored at the wrong rank.

## Non-Goals

- Changing an alert's wording or its due time. Those stay the writer's own, and
  no stored row's wording or due time is touched by this work. Which text an
  alert previews was left out of this work and then decided on its own. As
  shipped, converging the rank let the sweep's generic "is waiting without an
  owner" copy become the one shown on an unowned thread, in place of what the
  customer wrote. The owner decided on 2026-09-12 that a copy quoting a customer
  text is deliberately preferred over a generic one, and between two texts the
  most recent, so the rail shows the customer's latest words. It is a read-side
  rule (`shownInstead` in `src/lib/notification-facts.ts`), so it applies to rows
  already stored and needed no migration. Recorded in the decision log's
  Tradeoffs. A read-side rule can only choose between copies that exist, so the
  owner made a second call the same day for the case it could not reach, a
  thread texted while it had an owner and set to unassigned since: the
  operational sweep now quotes the customer's latest text itself. See
  [The Sweep Quotes the Customer's Latest Text](../decisions/2026-09-12-the-sweep-quotes-the-customer-s-latest-text.md).
- Changing how many rows a thread accumulates, or the read-side collapse. Those
  are settled in the 2026-08-19 decision and stay settled.
- Any change to who a thread's alerts are addressed to. The standing-alerts-
  after-reassignment defect is a separate piece of work.

## Acceptance Criteria

- Given a LOW conversation with no owner, when a customer's text arrives through
  the inbound webhook, then the alert it raises is stored at LOW.
- Given that alert standing, when the conversation is escalated and the
  operational sweep runs, then every standing copy of the alert reads the new
  rank.
- Given an alert about a missed response clock, a failed text, or an overdue
  follow-up, then it ranks at least at its own rank and never below the thread
  or follow-up it is about. (Changed 2026-09-12: its own rank used to replace
  the subject's whatever that was, see
  [An Alert's Own Rank Is a Floor](../decisions/2026-09-12-an-alert-s-own-rank-is-a-floor.md).)
- Given rows stored at the wrong rank before this change, when the migration
  runs, then they read their conversation's rank.
- Given an unowned conversation the customer has texted, when the sweep has
  raised its generic copy of the alert since, then the rail shows what the
  customer wrote - and on a thread with several unanswered texts, the most
  recent one. (Added 2026-09-12 with the owner's decision above.)
- Given a conversation the customer texted while it had an owner, when a manager
  sets it unassigned and the operational sweep runs, then the rail shows the
  customer's most recent text rather than "is waiting without an owner." And
  given nothing has changed since, when the Command Center loads again, then the
  sweep writes no alert row. (Added 2026-09-12 with the sweep change.)

## Risks / Open Questions

- **A brand-new unanswered customer text now reads NORMAL instead of HIGH, and
  that is the common case, not an edge one.** When a number the dealership has
  not seen texts in, the webhook creates the thread and nobody owns it.
  `Conversation.priority` is `@default(NORMAL)` (prisma/schema.prisma:239) and
  the webhook sets no priority when it creates one, so the alert that used to be
  hard-coded HIGH is now NORMAL. Two things an advisor actually sees change. It
  sorts below every `MESSAGE_FAILED` and every `FOLLOW_UP_OVERDUE` alert, since
  those two carry a fixed HIGH. And its Command Center badge turns from red to
  amber, because that badge is red only for URGENT or HIGH. The rest of the
  picture: a genuinely neglected text does not go quiet. Once the thread passes
  its department response clock the operational sweep raises `SLA_MISSED` at
  URGENT, so the escalation path for an ignored customer is intact and arrives
  as its own alert. This is a deliberate product consequence of the rule that an
  alert ranks where its thread ranks, not an incidental, and it is the reason
  this was filed as its own piece of work rather than folded into the 2026-08-19
  refactor.
- The same rule shows up more narrowly elsewhere on the rail: an unowned LOW
  thread now sorts below a NORMAL one.
- The seeded demo dataset shifts with it, in two places. The unassigned sales
  lead was written HIGH by hand over a NORMAL conversation and now reads NORMAL.
  The sales advisor's "New customer message" alert on the Panigale thread was
  written HIGH over an URGENT conversation and now reads URGENT. Both are the
  seed telling the truth about its own data rather than a regression, and
  together they reorder the demo rail, so it is worth seeing before the next
  demo.
- **The re-rank reaches a fact only when some writer raises it again**, and only
  over rows that are not resolved. The operational sweep re-raises
  `UNASSIGNED_CONVERSATION`, `FOLLOW_UP_DUE` and `FOLLOW_UP_OVERDUE` on every
  Command Center load, so those three converge on their own. `NEW_INBOUND_MESSAGE`,
  `CONVERSATION_ASSIGNED` and `CONVERSATION_REASSIGNED` are raised only by the
  inbound webhook and by `updateConversation`, and `updateConversation` raises
  nothing on a priority edit, so one of those alerts standing on a thread that
  is re-ranked afterwards keeps the rank it was written with. Same for a
  resolved copy that `reopenConversationNotifications` later revives. This is
  the behaviour before this change rather than something it introduced, and
  closing it means re-ranking a thread's alerts where its priority is edited,
  which is its own piece of work.
- Deactivating a staff member resolves none of their notification rows, so those
  copies stand indefinitely; after this change they at least converge to the
  right rank and collapse into one rail slot, which makes it row-growth hygiene
  for people who have left rather than a wrong-rank harm, and it is filed as its
  own piece of work.
- The guard against a future writer ranking an alert itself is a textual scan
  over the writers, which is best-effort rather than a proof.
- **The sweep now reads one more statement on every Command Center load**, to
  quote an unowned thread's latest text. It is one statement for all the unowned
  threads and none when there are none, and it adds no writes in the steady
  state. Rows written before the change keep their generic wording, so on a
  thread the customer has texted the first load after it writes a quoting copy
  per manager beside each generic copy, and the rail shows the quoting one while
  both are among the rows it reads. Dated by its text, that quoting copy sorts
  behind the newer generic copy, so enough same-rank rows between them (past 60
  on the rail, 300 on the Command Center) bring the generic line back until the
  alert ends. No new pair arises after the change, because the sweep writes a
  generic copy only for a thread the customer has never texted. The cost, and
  why it is one statement rather than a Prisma `include`, is in the
  [decision log](../decisions/2026-09-12-the-sweep-quotes-the-customer-s-latest-text.md).
- **A quoted unowned alert prints and lists by when the customer sent the text,
  not when the copy was written.** Settled after a race: the sweep could write
  its copy of an older text after the webhook wrote its copy of a newer one, and
  the rail, which shows the later of two copies quoting different texts, kept
  the older words. Dated by their texts, the newer text wins whichever copy is
  written last. So an alert the sweep raises hours after the customer's last
  text prints that text's age, and a generic copy keeps the time it was written.
  See the
  [decision log](../decisions/2026-09-12-the-sweep-quotes-the-customer-s-latest-text.md).

## Portfolio Notes

A defect that arrived with a written diagnosis in the code, which turned out to
be describing the wrong mechanism. Reproducing it in the running app first - a
seeded dealership, a signed webhook, a LOW thread listed 19th at HIGH - was what
showed that the two writers never collide at all, and that the fix the note
implied would have left the shape in place. The decision log is
[An Alert Ranks Where Its Subject Ranks](../decisions/2026-09-12-an-alert-ranks-where-its-subject-ranks.md).
