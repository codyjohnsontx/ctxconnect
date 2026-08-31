# PRD: Attend Works on the Shop Floor

## Status

Built

## Date

2026-08-31

## Owner

Cody Johnson

## Summary

A service advisor is not at a desk. She is at the write-up lane with a phone in
one hand and a customer in front of her, and on that screen Attend was close to
unusable: the conversation showed through a 287px porthole, every thread opened
on its oldest message, there was no way to see whose account was sending the
texts or to leave it, and the filter controls pushed the ranked queue most of
the way off the screen with no way back out of a filter that matched nothing.

Four fixes, all of them layout and none of them new capability. The conversation
now fills the phone and opens on the message she came to answer, the bottom bar
names who is signed in and signs her out in two taps, and the filters fold away
so the queue is what she lands on.

## Problem

Reproduced end to end before any of it was fixed, in the running app against
real Postgres, signed in as the service advisor (`service@ctxchat.local`), on an
emulated iPhone 12 Pro (390x844, DPR 3, touch, mobile user agent) - not a narrow
desktop window. Measured in the page:

1. **The conversation renders in a porthole.** The message list was
   `max-h-[34dvh] ... overflow-y-auto`, so on a 390x844 screen the thread got a
   **287px** box with its own scrollbar, inside a page that scrolled separately.
   Two nested scrollers, one of them a fifth of the screen, on the surface the
   whole product exists to show.
2. **A thread does not open on its newest message.** The thread renders oldest
   first and nothing moved it, so `scrollTop` was **0** on open: the top of an
   eight-hour-old conversation. The message the queue row previewed - the one
   she tapped the row to answer - was below the fold of a 287px box.
3. **No account cell and no sign out on a phone.** The sidebar that names the
   signed-in account and offers sign out is `hidden lg:flex`. On a phone a scan
   for a visible sign-out control returned **0**. A dealership phone gets handed
   between shifts, so the advisor could neither see whose account she was
   texting from nor leave it.
4. **The filters bury the queue and clearing them is a dead end.** The filter
   grid ended **324px** down an 844px screen before the first queue row began.
   Filtering to nothing said "No conversations match these filters." with **no
   link out of it** - and the same sentence appeared when the queue was simply
   empty, sending her looking for a filter that was not set.

## Target User

The service advisor, on the shop floor, one-handed. Everything here is already
correct on the desktop she uses when she is at the counter; none of it was ever
correct on the device she is actually holding when a customer is standing there.

## Goal

The four things she does on a phone all work: read the queue, open a thread on
the message that needs answering, narrow and unnarrow the queue, and get out of
someone else's account.

## Background

The wide layout was built first and the phone layout inherited its rules. Every
one of these defects is that inheritance: a height cap that made sense for a
thread column beside a queue and an alert rail, a sidebar that carries the
account block, a filter row that costs nothing in a 390px rail beside the queue
and costs the whole first screen when it is stacked above it.

## v1 Scope

- The message list stops capping its own height and stops being its own scroll
  box below `lg`. On a phone the conversation is part of the page; from `lg` up
  the thread column is still its own scrolling box, as it was.
- A thread opens with its newest message on screen and the reply box under it,
  follows a message the advisor writes herself, and holds her place while she
  reads back through history.
- The mobile bottom bar's last cell names the signed-in account, and opens a
  panel carrying the full name, the role, the theme toggle and **Sign out**.
- The filter controls collapse behind a **Filters** summary below `lg`, opened
  by default whenever a filter is in effect and carrying a count of how many.
- **Clear filters** widens the queue without leaving the thread she is reading,
  offered under the controls when filters are narrowing a queue that still has
  rows, and in the empty state when they have narrowed it to nothing.
- The empty state distinguishes "these filters match nothing" from "the queue is
  empty".

## Non-Goals

- **Removing the `font: inherit` reset in `globals.css`.** It is unlayered, so
  it beats every Tailwind `text-*` and `font-*` utility on every button, input,
  select and textarea in the product. Deleting it is right and is a change with
  an app-wide blast radius that wants its own pass and fresh screenshots. Not
  here. The account cell sizes its label on a `<span>` instead, and the panel is
  sized to hold controls that set at the body's 16px.
- **Collapsing the filters on desktop.** The 390px rail has room for the
  controls and the queue together. The collapse is a phone answer to a phone
  problem.
- **Carrying a filter the form cannot show.** See
  [the decision](../decisions/2026-08-31-the-filters-collapse-on-the-phone-only.md).
- Any change to what the queue query returns, what a thread contains, or who can
  see either.

## User Flow

1. She opens Attend on her phone at the write-up lane. The header, the AI pass
   line, and a **Filters** summary sit above the queue; the first ranked row
   starts **205px** down instead of 324px, and three rows have started before
   the fold.
2. She taps the top row. The thread opens on the last exchange with the reply
   box directly under it - not on a message from this morning inside a porthole.
3. She scrolls back to check what was promised last week. Nothing pulls her
   away from it.
4. She writes an internal note. The thread follows down to her own words, so
   she can see it landed.
5. She taps **Filters**, sets Department to Service, presses Filter. The
   controls stay open with **1 active** beside them, and **Clear filters** under
   them.
6. She narrows it to nothing by accident. The empty state says so and links
   straight back to the whole queue.
7. She hands the phone to the next shift. Two taps - the account cell, then
   **Sign out**.

## Requirements

- Nothing scrolls horizontally at any phone width.
- The wide layout is unchanged apart from the two fixes that are not
  width-specific: a thread opens on its newest message, and **Clear filters**
  appears while a filter is active.
- No new client-side state. The collapse is a CSS-only disclosure and the
  account panel is a native popover, so both work before hydration and both
  survive a server render.
- The rule for where a conversation opens lives in one database-free module and
  is tested without a browser.

## Acceptance Criteria

- Given a 390x844 phone, when the advisor opens a conversation, then the message
  list is not its own scroll box and has no height cap, the newest message is on
  screen, and the reply box is on screen under it.
- Given she has scrolled back through history, when the thread re-renders for
  any reason other than a new message, then the scroll position does not move.
- Given she writes a reply or a note, when it appears, then the thread moves to
  it even if she was reading history.
- Given a phone, when she taps the last cell of the bottom bar, then a panel
  names the account in full with its role, and offers **Sign out**; pressing it
  ends the session and lands on `/login`.
- Given a phone and no filters, when the inbox loads, then the filter controls
  are collapsed and the first queue row is visible.
- Given any filter is in effect, when the inbox loads, then the controls are
  open, the count is shown, and **Clear filters** is offered.
- Given filters that match nothing, when the empty state renders, then it says
  the filters are why and links back to the whole queue; given no filters and an
  empty queue, it does not blame filters.
- Given a viewport of 1024px or wider, then the filter controls are on screen
  with no summary above them, and every screen renders as it did before.
- Given any width from 320px to 1024px, then nothing scrolls horizontally.

## Edge Cases

- **A thread shorter than the screen** ends above the fold and has nothing to
  scroll. That counts as showing the newest message rather than as history.
- **An over-scroll bounce** past the end on iOS drags content up past where it
  settles; also showing the newest message, not history.
- **A phone turned sideways** past `lg` swaps which element scrolls. Both
  candidates are listened to and the scroll event names which one answered.
- **A browser without the popover API** never shows the account panel, rather
  than showing one it cannot close over the bottom bar. The cell does nothing
  there, so sign out on such a phone is where it was before this work: only in
  the wide layout's sidebar.
- **An account with no name stored** - `User.name` is nullable and a
  bootstrapped admin can have none - shows `?` in the avatar and "Account" as
  the label, and the panel agrees with the cell.
- **A `priority` filter arriving on the URL** has no control in the form. It is
  counted, so the queue is never quietly short, and **Clear filters** is the way
  out of it.
- **Clearing filters from inside a thread** keeps the thread open and keeps the
  back link's origin.

## Data Requirements

None. Nothing here reads, writes, or changes a row.

## Analytics / Success Metrics

No real usage metrics; there are no users yet. The intended signal is that a
conversation opened on a phone needs no scrolling before it can be read or
answered, and that the advisor can hand the phone to the next shift without
asking anyone how.

Measured in the running app rather than claimed:

| | Before | After |
|---|---|---|
| Message list height, 390x844 | 287px, own scrollbar | full content, scrolls with the page |
| Thread scroll position on open | top (oldest message) | newest message on screen, reply box under it |
| Visible sign-out controls on a phone | 0 | 1, two taps away |
| Top of the first queue row, 375x667 | 324px | 205px |
| Ways out of a filtered-to-empty queue | 0 | 1 |

## Risks

- **The wide layout regressing where nobody looked.** Answered rather than
  assumed: every route was screenshotted at 1440x900 in light and dark before
  and after, and pixel-compared. Everything is identical except the thread's
  scroll position and the new **Clear filters** link, both of which are the
  fixes.
- **The unlayered `font: inherit` reset.** It caught the account cell during
  this work - the name set at 16px beside 10px navigation labels. It will catch
  the next control added to the bar the same way. Recorded in `AGENTS.md`.
- **A CSS-only disclosure is a checkbox, not a `<summary>`.** Assistive
  technology announces it as a checkbox named "Filters". Accepted, because no
  author style can reopen a closed `<details>` and the desktop must not
  collapse; the control is labelled and operable, and carries `aria-controls`.

## Open Questions

- Whether the theme toggle losing its one-tap cell in the bottom bar matters. It
  now lives one tap deeper, inside the account panel. Nothing suggests it is a
  frequent action on the shop floor.

## Implementation Notes

- `src/lib/thread-scroll.ts` holds where a conversation opens and when it moves,
  written against where content ends on screen rather than one box's scroll
  numbers, so one tested rule serves both layouts.
  `src/components/thread-messages.tsx` applies it; it is a ref callback rather
  than an effect so the thread is already at its newest message before the
  browser paints.
- `src/lib/inbox-filters.ts` holds what is narrowing the queue and the way out.
  Its key list is pinned to `InboxFilters` by the compiler and to the query by a
  test, so a filter the query honours can never go uncounted.
- `src/lib/account-identity.ts` holds how an account is named in one 60px cell.
- Tests: `tests/thread-scroll.test.ts`, `tests/inbox-filters.test.ts`,
  `tests/account-identity.test.ts` for the rules;
  `tests/phone-layout.test.ts` for the three layout invariants that are class
  lists rather than functions.

## Portfolio Notes

The product decision worth talking about is the one that was refused. The
original attempt at the account cell bundled the deletion of an app-wide CSS
reset into the same change - a correct diagnosis with a blast radius across
every button and field in the product, arriving inside a commit whose headline
was a mobile menu. Splitting that out kept the phone fix small enough to verify
and left the app-wide change to be made deliberately, with its own visual pass.

The second is the filter that was left behind. Collapsing the controls raised
the question of what happens to a filter with no control in the form, and the
cheap answer - carry it forward in a hidden input - would have preserved a
filter the advisor cannot see, cannot change, and did not set. Counting it and
offering an exit is the honest answer; scaffolding a feature nobody asked for is
not.

The third is that "unchanged" was proved rather than asserted. Every route was
captured at desktop and phone sizes in both themes before the work started and
pixel-compared afterwards, so the claim "the desktop layout is unchanged" has a
number behind it and the two places it *did* change are named.
