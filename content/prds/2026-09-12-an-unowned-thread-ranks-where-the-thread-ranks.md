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

- Changing an alert's wording, its due time, or which text it previews. Those
  stay the writer's own.
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
  follow-up, then it keeps its own rank whatever the thread is ranked at.
- Given rows stored at the wrong rank before this change, when the migration
  runs, then they read their conversation's rank.

## Risks / Open Questions

- The rail's order changes for real. An unowned LOW thread now sorts below a
  NORMAL one. That is intended, and it is the reason this was filed as its own
  piece of work rather than folded into the 2026-08-19 refactor.
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
- The guard against a future writer ranking an alert itself is a textual scan
  over the writers, which is best-effort rather than a proof.

## Portfolio Notes

A defect that arrived with a written diagnosis in the code, which turned out to
be describing the wrong mechanism. Reproducing it in the running app first - a
seeded dealership, a signed webhook, a LOW thread listed 19th at HIGH - was what
showed that the two writers never collide at all, and that the fix the note
implied would have left the shape in place. The decision log is
[An Alert Ranks Where Its Subject Ranks](../decisions/2026-09-12-an-alert-ranks-where-its-subject-ranks.md).
