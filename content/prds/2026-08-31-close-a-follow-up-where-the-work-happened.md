# PRD: Close a Follow-Up Where the Work Happened

## Status

Built

## Date

2026-08-31

## Summary

A follow-up could only be finished on the Tasks page, from a status dropdown
behind an Update button. The advisor does the work in the conversation, so
finishing it meant leaving the thread, finding the row again, and pressing two
controls. The thread's "Open follow-ups" card now carries a **Mark done**
button, and an overdue follow-up reads as overdue there the way it already does
on Tasks.

## Problem

The conversation thread is where a follow-up is created and where the work it
describes actually gets done - the advisor calls the customer back, the part
arrives, the claim is escalated. It was not where the follow-up could be
closed.

Reproduced in the running app on real Postgres, signed in as the service
advisor. Opening a seeded thread with an open follow-up showed the card with its
title, due date and assignee, and no control of any kind. Closing it meant
navigating to `/tasks`, scanning for the same title, changing a `Select` from
Open to Done, and pressing Update.

Two consequences, and the second is the one that matters:

- **The queue rots.** A follow-up that costs a page change to close is a
  follow-up that stays open. Once a handful of finished items sit in the list,
  the follow-up count and the "Follow-up" badge stop describing work and the
  advisor stops reading them.
- **Overdue looked different in the two places.** The Tasks page marks an
  overdue follow-up with a red badge and red due text. The thread rendered
  "Due 3 days ago" in the same grey as everything else, so the surface she is
  actually standing on was the one that under-reported.

## Target User

The service advisor, in the thread. She is the person who does the work the
follow-up describes, so she is the person who knows it is done.

## Goal

A follow-up can be finished from the conversation, and looks as late there as it
does on the Tasks page.

## v1 Scope

**One button, on the card that already exists.** The "Open follow-ups" card in
the conversation aside gains a **Mark done** submit that posts to the existing
`updateTaskStatus` server action with `status=DONE`. No new write path: the
action already resolves the follow-up's alerts, writes the audit row and
revalidates the three pages, and all of that now happens from the thread too.

**The access rule moved into a shared, tested module.** A thread's follow-up
list is not scoped by the reader - a service thread can carry a parts follow-up
- so the button has to be offered only where the write would succeed.
`updateTaskStatus` had that rule written inline as a four-clause negation, and
the component could not read it. `src/lib/task-access.ts` now holds
`canUpdateTask`, alongside `scopedTaskWhere` and `isManagerOrAdmin` moved from
`permissions.ts`, which keeps re-exporting all three so callers still have one
place to ask about permissions. Same shape as `conversation-access.ts`, for the
same reason.

**A follow-up she may not close says who can.** Rather than a disabled button or
silence, the card reads "Parts closes this one." The advisor is told why there
is nothing to press and who to chase.

**Overdue reads the same in both places.** The thread's card gets the red
`Overdue` badge and red due text the Tasks page card already had. The clock is
read once per request outside the render, matching how the Tasks page does it,
so every follow-up on the page is compared against the same instant.

## Non-Goals

- **Any other status.** Only DONE is offered from the thread. Cancelled,
  In progress and re-opening stay on the Tasks page, which has the full
  dropdown; they are bookkeeping states, and the thread's question is "is this
  finished".
- **Creating a follow-up from the Tasks page.** Still not possible; the thread
  remains the only creation surface. Filed, not fixed here.
- **`updateTaskStatus` itself.** Its behaviour is unchanged - the extracted
  predicate is the same rule it already enforced, and the test pins that
  equivalence.

## Acceptance Criteria

- Given an open follow-up on a thread in the advisor's own department, when she
  presses Mark done, then it leaves the thread's open list, leaves her Tasks
  Open tab, and its alerts are resolved.
- Given a follow-up past its due date, when she looks at the thread, then the
  card carries a red Overdue badge and red due text, the same as the Tasks page.
- Given a follow-up owned by a department she cannot act for, when she looks at
  the thread, then there is no button and the card names the department that
  closes it.
- Given a manager or admin, when they open any thread, then every follow-up on
  it offers Mark done.

## Risks / Open Questions

- **Mark done is one press with no undo in the thread.** Accepted: re-opening a
  follow-up is on the Tasks page, and a confirmation step on the common action
  is what sends her back to Tasks in the first place.
- **The permission rule now lives in a module the component imports.** That is
  the point - but it means a future edit to `canUpdateTask` changes both the
  button and the write at once. The test in `tests/task-access.test.ts` pins the
  filter and the predicate against each other over every reader, department and
  assignee combination, so a change that breaks the agreement fails there.
- No live usage metrics; the product has no real dealership traffic. The signal
  to watch is whether the Open tab on Tasks still fills up with work that was
  finished days ago.

## Portfolio Notes

The interesting decision was refusing to render a disabled button. The thread's
follow-up list is deliberately unscoped - the advisor should see that parts is
also working her customer - so some cards genuinely have nothing for her to
press. A greyed-out button reads as "the app is broken"; naming the department
that owns it turns the same fact into a route to the answer.
