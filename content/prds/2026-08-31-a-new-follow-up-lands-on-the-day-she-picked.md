# PRD: A New Follow-Up Lands on the Day She Picked

## Status

Built

## Date

2026-08-31

## Summary

A follow-up created from the thread was stored against the server's clock rather
than the advisor's. On Vercel the server stands in UTC and she does not, so a
follow-up she set for half past midnight was stored - and shown back to her -
at half past seven the evening before, on the wrong day. The create form now
reads her pick in the browser and posts an instant, the way rescheduling a
follow-up already did.

What is fixed here is what gets *stored*. Command Center still reasons about a
due date on the server's clock, and correcting the stored instant moves all
three of the things it does with one: the date it prints, which follow-ups it
counts as due today, and which it raises an alert for. All three were
accidentally right before, off a wrong instant. That is a behaviour change this
change causes, set out under Risks.

## Problem

Reproduced in the running app before anything was changed, with the dev server
restarted under `TZ=UTC` and the browser left in `America/Chicago`:

- The advisor opens Ruben Ortega's thread and creates a follow-up due
  **1 September, 00:30** on her clock.
- The form posts the picker's bare `2026-09-01T00:30`, which names no timezone.
- `createTask` calls `new Date()` on it and gets **2026-09-01T00:30Z**, because
  that is what the string means where the server is standing.
- The row stores that, and Attend shows her the follow-up as due
  **31 August, 19:30**. Five hours early, and the wrong day.

The date she is offered by default had the same fault from the other side: it
was computed on the server, so `defaultFollowUpDueDate` was reasoning about the
server's working day. Emulating `Pacific/Auckland` - where her evening is
already the server's tomorrow - the form offered her 17:00 on a day that had
already ended, rather than the 09:00 next morning the rule is written to give.

[Move a Follow-Up When the Plan Moves](./2026-08-31-move-a-follow-up-when-the-plan-moves.md)
fixed this for `rescheduleTask` and named `createTask` as a non-goal, so the two
writers sat side by side in the same product disagreeing about what a due date
is: a follow-up created for 5pm and rescheduled to 5pm showed two different
times.

## Target User

The service advisor, creating a follow-up from the thread - the only place in
Attend a follow-up is created.

## Goal

A follow-up comes due at the moment she picked, whatever timezone the server is
deployed in.

## v1 Scope

**The due date is read in the browser.** `FollowUpDueDate` is a client component
holding the create form's date field. The picker carries no `name`; the hidden
`dueAt` beside it carries her pick converted through `instantFromDateTimeLocal`,
so what crosses the wire names its offset.

**The default is computed in the browser too.** `defaultFollowUpDueDate(new Date())`
now reads her clock. The server pass renders the field empty rather than its own
answer, the way `LocalTimestamp` renders a placeholder - a value that would
visibly change on hydration is worse than one that arrives a moment late, and an
empty `required` field also means a page that has not hydrated cannot submit a
date that was never converted.

**`createTask` refuses a wall clock.** It reads `dueAt` through
`instantFromZonedIso` and throws when that returns null, matching
`rescheduleTask`. A regression shows up as the action erroring rather than as a
wrong hour nobody notices. The audit row records the instant rather than the
string it arrived as.

**The field still resets with the rest of the form.** React restores the
uncontrolled fields once the action resolves; the draft is dropped on the same
transition so the due date does not become the one field that disagrees.

## Non-Goals

- **Changing what a follow-up is, or when it is due by default.** The rule in
  `defaultFollowUpDueDate` is unchanged; it is now applied to her day rather
  than the server's.
- **Moving follow-ups already written against the server's clock.** Rows created
  before this are still wrong by the server's offset. Rewriting them would need
  a timezone per row that was never recorded, and the advisor can move any one
  of them in a press.
- **A timezone per user.** Attend reads the browser's, which is right for a
  dealership whose staff stand in one place, and wrong the moment someone works
  a Saturday from another state. It has never been asked for.

## Acceptance Criteria

- Given the server in UTC and the advisor in `America/Chicago`, when she creates
  a follow-up due 1 September at 00:30, then the row stores
  `2026-09-01T05:30Z`, and the thread's open-follow-up card, the Tasks page and
  the reschedule picker all place it on 1 September at 00:30. Command Center
  still does not: it prints the due date on the server's clock, and it buckets
  "due today" and sweeps `FOLLOW_UP_DUE` alerts against the server's day. This
  change makes that visible rather than fixing it, and it is recorded under
  Risks.
- Given the same pair, when she looks at the due field before touching it, then
  it offers a time inside her own working day.
- Given a submission that carries no converted instant, when it reaches
  `createTask`, then the follow-up is not written.
- Given a picked value the date reader will not convert, when she submits, then
  the form does not post, the picker is marked invalid, and the reason is on
  screen rather than on an error page.
- Given she has just created a follow-up, when she looks at the form, then the
  due date has returned to the default alongside the cleared title.

## Risks / Open Questions

- **Command Center still reads a due date on the server's clock, in three
  places, and this change moves all three of them.** What is fixed here is
  what gets *stored*. These reason about the server's zone rather than hers,
  and they are one defect with one fix, tracked as separate work rather than
  folded in here:
  - **The rendered meta line.** The "Due today" and "Overdue" focus items build
    their meta with ``due ${task.dueDate.toLocaleString()}`` inside
    `getCommandCenterFocusItems` (`src/lib/data.ts`), which runs in the server
    render, so the string is formatted wherever the server is standing. It was
    accidentally correct before this change, because the write was wrong by the
    advisor's offset in the opposite direction: a follow-up she picks for
    1 September at 20:00 from `America/Chicago` was stored as
    `2026-09-01T20:00Z`, and a server in UTC printed "9/1/2026, 8:00:00 PM" -
    exactly the wall clock she picked. It is now correctly stored as
    `2026-09-02T01:00Z`, and the same server prints "9/2/2026, 1:00:00 AM" - the
    right instant on the wrong clock, the wrong hour and the wrong day.
  - **Day-bucketing.** The "Due today" focus list selects with
    `dueDate: { gte: now, lte: todayEnd }` where `todayEnd = endOfDay(now)`
    (`src/lib/data.ts:602`) is computed in the server's zone, so which
    follow-ups count as due today is the server's day rather than hers.
  - **The alert sweep.** `syncOperationalNotifications` does the same with
    `todayEnd.setHours(23, 59, 59, 999)` (`src/lib/notifications.ts:254-255`,
    applied at `:278`), so `FOLLOW_UP_DUE` alerts follow that same boundary.

  **All three defects predate this change, and this change unmasks all three.**
  Two errors were cancelling: a write wrong by the advisor's offset, and reads
  wrong by the same offset the other way. Server in UTC, advisor in
  `America/Chicago`, she picks 1 September at 20:00. `endOfDay(now)` is
  `2026-09-01T23:59:59.999Z`, and the old buggy write stored
  `2026-09-01T20:00Z`, which is *inside* that bucket. So the follow-up appeared
  under "Follow-ups due today", raised a `FOLLOW_UP_DUE` alert that day, and
  printed as "9/1/2026, 8:00:00 PM" - all three right, by accident, off a wrong
  instant. The corrected instant is `2026-09-02T01:00Z`, which is *outside* the
  bucket, so the same follow-up now reads as due tomorrow, misses that day's
  sweep, and prints "9/2/2026, 1:00:00 AM". Removing the error that was hiding
  them is what made them visible. Every evening pick west of the server buckets,
  alerts and prints differently from now on, and it stays that way until the
  Command Center work lands.

  **Why this ships before the display fix.** It leaves three surfaces
  temporarily wrong, and that is still the right order. A wrong instant written
  today is wrong forever: every follow-up created before this change carries bad
  data permanently, because the zone it was picked in was never recorded and
  cannot be recovered. A wrong label is wrong only until someone fixes the
  label. Data correctness compounds; presentation does not. So the correct write
  is taken now and a short, loudly documented window on display is accepted,
  with the Command Center work dispatched immediately rather than left queued.

  **The other half improves.** `overdue` is a plain instant comparison
  (`dueDate < now`, `src/lib/data.ts:395`, and `task.dueDate.getTime() < now`,
  `src/app/(app)/tasks/page.tsx:34`), so it is now right where it previously
  flagged an 08:00 Chicago follow-up as overdue at 04:00 on her clock.

  `LocalTimestamp` (`src/components/local-timestamp.tsx`) is already the repo's
  answer for rendering an instant on the reader's clock. Not affected: the
  thread's open-follow-up card and the Tasks page, which use
  `formatDistanceToNow` and are timezone-independent, and the reschedule picker,
  which reads the stored instant on her own clock.
- **The field is empty until the page hydrates.** For that moment the form
  cannot be submitted at all. That is the intended trade - the alternative is
  rendering a date the server made up - but it is a visible flash on a slow
  phone.
- **Existing rows stay wrong.** See the non-goal above. Nothing marks them, so
  the only signal is an advisor noticing a follow-up came due at the wrong hour.
- No live usage metrics. The signal to watch is whether follow-ups stop coming
  due outside the hours the shop is open.

## Portfolio Notes

The interesting part was that the bug had already been diagnosed and
deliberately left alone. The reschedule work found it, proved its own path
correct with the server in UTC and the browser in Central time, and wrote the
older writer up as a non-goal rather than quietly widening its own diff. That
left a precise, reproducible defect and a shared module already built to fix it,
which is why this change is small.

What made it worth its own pass was the second half nobody had noticed: the
*default* date was server-computed too, so the bug survived a naive fix of the
write. Reproducing from a timezone where the server's day and the advisor's day
genuinely differ - rather than the five-hour offset where they usually agree -
is what surfaced it. The regression test pins both ends: a date picker may only
be rendered where the timezone is known, and a server action may only accept a
date that names its offset.
