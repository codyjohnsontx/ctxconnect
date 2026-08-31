# PRD: Move a Follow-Up When the Plan Moves

## Status

Built

## Date

2026-08-31

## Summary

A follow-up's due date was set once, at creation, and nothing in Attend could
ever change it. When the plan slipped - "actually, call me Thursday" - the
advisor's only options were to mark a follow-up done that was not done, or leave
it permanently red. A follow-up can now be moved, from the Tasks page or from
the conversation where the customer said so, with one press for the two answers
she gives most often.

## Problem

`createTask` wrote `dueDate` and no other code path touched it. `updateTaskStatus`
changes status only. Reproduced in the running app as the service advisor: every
surface that shows a follow-up shows its due date, and none of them let her
change it.

What that costs is not a missing field, it is a dishonest queue. A customer
moving a plan is ordinary - the part is late, they are away until Monday, the
claim is still with the manufacturer. With no way to record that:

- **Marked done** is the fast way to clear the red, and it records work as
  finished that has not been done. Nothing is left to remind her.
- **Left alone**, the follow-up is overdue from the moment the old date passes,
  and stays overdue. Once several rows are permanently red, the red stops
  meaning anything, which takes the honest overdue rows down with it.

## Target User

The service advisor, in the thread and on her Tasks page. The thread matters
more: it is where the customer tells her the plan has moved, so it should be
where the follow-up moves with it.

## Goal

A slipped plan can be recorded as a slipped plan.

## v1 Scope

**One panel, rendered wherever a live follow-up is.** `RescheduleFollowUp`
opens from a **Reschedule** button on the Tasks card and on the thread's
"Open follow-ups" card. It offers **Tomorrow** and **In a week** as one press
each, plus a date picker for anything else. Both quick answers land at opening
time, because the hour she happens to be at the counter is not an hour she will
be reading her queue.

**The dates it offers are computed where the timezone is known.** The panel is a
client component, so `followUpSnoozeOptions(new Date())` reads her clock, not the
server's.

**What crosses the wire is an instant, not a wall clock.** This is the part
worth spelling out. `datetime-local` produces `2026-08-31T17:00` with no offset,
and `new Date()` on that string reads it wherever the code is running. On Vercel
that is UTC, so a follow-up she sets for closing time is stored five or six hours
early and comes due at lunchtime. `src/lib/follow-ups.ts` now owns both ends of
the trip: `instantFromDateTimeLocal` turns her pick into an instant in the
browser, and `instantFromZonedIso` refuses to accept anything at the server
action that does not name its offset. The refusal is the point - it makes reading
a bare local value on the server impossible rather than merely discouraged.

**Client state, not an uncontrolled form.** React restores a form's mounted
values once its action resolves, so a field seeded from the row it edits shows
the old date immediately after saving the new one, and a second press writes the
stale value back. The panel holds the draft in state and re-seeds from the
server during render, which also covers the first hydration pass: the server
rendered the instant in its timezone and the browser re-reads it in hers.

**Moving a follow-up withdraws its alerts.** A standing "Follow-up overdue" was
raised against the old date and its wording is false the moment the date moves.
`rescheduleTask` resolves the task's notifications; the operational sweep raises
a fresh one when the new date actually arrives.

**Permissioned by the same rule as closing one.** `canUpdateTask` from
`src/lib/task-access.ts`, so the button appears exactly where the write would
succeed. See
[Close a Follow-Up Where the Work Happened](./2026-08-31-close-a-follow-up-where-the-work-happened.md).

## Non-Goals

- **Fixing `createTask`'s due date.** It still calls `new Date()` on the bare
  local string from the create form, so a follow-up's *first* date carries the
  server-timezone defect this change refused to reproduce. That is an older bug
  on a different write path, it changes the behaviour of a feature outside this
  work, and it deserves its own change and its own verification. Named here so
  it is not mistaken for something this introduced. The two writers are
  deliberately not unified yet: the shared module is in place for whoever fixes
  it.
- **Changing what a follow-up is.** No new fields, no recurrence, no snooze
  history. The audit row records `from` and `to`; that is the whole record.
- **Rescheduling in bulk.** One follow-up at a time.
- **Reschedule on a finished follow-up.** Offered only while the follow-up is
  OPEN or IN_PROGRESS - a date on a closed one has nothing left to move.

## Acceptance Criteria

- Given an open follow-up on the Tasks page, when the advisor presses
  Reschedule and then Tomorrow, then its due date moves to 9am tomorrow in her
  own timezone and the card re-reads with the new date.
- Given the same follow-up in the conversation, when she presses Reschedule,
  picks a date and presses Move follow-up, then the date moves and the panel
  closes.
- Given a follow-up she rescheduled while an overdue alert stood against it,
  when she looks at the alert rail, then that alert is gone.
- Given a follow-up owned by a department she cannot act for, when she looks at
  the thread, then no Reschedule button is offered.
- Given the picker still showing the date the follow-up already has, when she
  looks at Move follow-up, then it is disabled.

## Risks / Open Questions

- **Two writers now disagree about time.** `rescheduleTask` stores the instant
  she meant; `createTask` stores the server's reading of her wall clock. Until
  `createTask` is fixed, a follow-up created at 5pm and rescheduled to 5pm can
  show two different times. That is the pre-existing bug becoming visible, not a
  new one, and the alternative - reproducing it in a second writer - is what the
  triage flagged.
- **Quick options are opinionated.** Tomorrow and a week, at 9am. If the pair
  turn out to be wrong, they are two lines in `followUpSnoozeOptions` with a
  test.
- **No history of moves.** The audit log holds each move; nothing surfaces it.
  A follow-up moved five times reads exactly like one moved once, which is
  arguably something a manager would want to see.
- No live usage metrics. The signal to watch is whether follow-ups still get
  marked done on days nothing was actually finished.

## Portfolio Notes

The feature is small. The interesting decision was refusing to copy the existing
code. Attend already had a due-date writer, and the fastest way to ship this was
to write the second one the same way - `new Date(formData.get("dueDate"))` -
which is exactly what the reference implementation did. That reads as consistent
and is wrong in a way nobody notices locally, because a developer's machine and
their database usually sit in the same timezone; it only appears in production,
where the server is UTC and the advisor is not.

The fix was not "convert carefully". It was to make the wrong thing not fit:
the browser is the only place that knows her timezone, so the conversion happens
there, and the server refuses any value that has not been through it. The bare
local string is now a type error in spirit and a `null` in practice.
