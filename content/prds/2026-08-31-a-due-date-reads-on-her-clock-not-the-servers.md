# PRD: A Due Date Reads on Her Clock, Not the Server's

## Status

Built

## Date

2026-08-31

## Owner

Cody Johnson

## Summary

Command Center read every follow-up due date on the server's clock - UTC on
Vercel, and nobody's clock. A follow-up the advisor set for 10pm last night
printed as due 3am today, and one she set for 8pm tonight was missing from
**Follow-ups due today** and never raised an alert. The printed moment now
renders in her browser, and whether a follow-up is due today is answered on the
dealership's day.

## Problem

A due date is stored as an instant. An instant is not a day until something
picks a timezone to read it in, and three surfaces picked the server's:

1. the printed due date on a Command Center focus row (`src/lib/data.ts`);
2. the **Follow-ups due today** metric and the list behind it, bucketed against
   `endOfDay(now)`;
3. `syncOperationalNotifications`, which raises `FOLLOW_UP_DUE`, bucketed the
   same way against `setHours(23, 59, 59, 999)`.

None of them were visible until this morning. `createTask` wrote a bare wall
clock, so an 8pm Central pick was stored as `20:00Z` - the wrong instant, but
read back on the same wrong clock it printed her own pick and landed inside the
server's day. Two errors cancelled.
[A New Follow-Up Lands on the Day She Picked](./2026-08-31-a-new-follow-up-lands-on-the-day-she-picked.md)
fixed the write, which is what uncovered these three.

Reproduced in the running app on real Postgres, dev server under `TZ=UTC`,
Chrome emulating `America/Chicago`, signed in as the service advisor, with three
follow-ups stored as the instants her picks name:

| She picked | Stored | Command Center said |
|---|---|---|
| today 5:00 PM | `2026-08-31T22:00Z` | due **8/31/2026, 10:00:00 PM** |
| yesterday 10:00 PM | `2026-08-31T03:00Z` | due **8/31/2026, 3:00:00 AM** - the wrong day |
| today 8:00 PM | `2026-09-01T01:00Z` | absent: metric read **1**, no row, no alert |

The third is the one that costs her a customer. A follow-up set for the end of
her shift is neither on the board nor in the alert rail, and there is nothing on
screen to tell her it is missing.

One half improved rather than broke and must stay improved: **Overdue** is a
plain instant comparison, so it is now correct where it used to flag an 8am
Central follow-up as overdue at 4am her time.

## Target User

The service advisor, on Command Center. The follow-up board is the thing she
opens to find out what today owes her.

## Goal

The day a follow-up counts on, and the time she reads it at, are both answers
about her dealership and her clock rather than about where the server is
standing.

## Background

The remedy for the printed moment already existed: `LocalTimestamp`, a client
component Settings uses to show an admin an access record on the clock they are
comparing it against. It could not be used from `data.ts`, which produced the
due date already formatted into a `meta` string.

The two query surfaces are the harder half, because a sweep run from a cron has
no viewer to ask what day it is. Whose day it should use is a product decision,
recorded in
[The Dealership Owns the Day a Follow-Up Is Due On](../decisions/2026-08-31-the-dealership-owns-the-day-a-follow-up-is-due-on.md).

## v1 Scope

**The dealership's day, in one shared module.** `src/lib/dealership-day.ts`
answers when the dealership's day ends, in the zone named by
`DEALERSHIP_TIME_ZONE` (default `America/Chicago`). Both the Command Center
bucket - the metric count and the focus list, which must agree - and the alert
sweep call it. Same shape as the other rules several screens have to share.

**The printed moment goes to the browser.** The task focus row now carries
`dueAt`, the instant, instead of a due date already formatted into its `meta`
string. Command Center renders it through `LocalTimestamp`.

**Nothing else changes clock.** `Overdue` stays a plain instant comparison. The
message-volume and response-time windows stay on the server's day.

## Non-Goals

- **A stored dealership timezone.** No `DealershipSettings` column and no
  settings control. Attend serves one dealership; the reasoning and the cost of
  reversing it are in the decision log.
- **The message-volume and response-time windows.** `todayStart`/`todayEnd` in
  `getCommandCenterData` still bound "messages today" and the 14-day response
  window on the server's day. Same class of defect, different question, and
  folding it in would turn a defect fix into a rewrite of the analytics window.
  Reported, not fixed.
- **Naming the dealership's timezone on screen.** Considered for the advisor who
  is outside it; cut as chrome on every load for an edge a single-site
  dealership does not hit.
- **Every other date on screen.** `formatDistanceToNow` - the Tasks page, the
  thread, the alert rail, the queue rows - measures the gap between two
  instants and has no timezone in it. Checked, correct, untouched.

## User Flow

1. The advisor creates a follow-up from the thread for 8pm, the end of her
   shift, and Attend stores the instant she meant.
2. She opens Command Center. **Follow-ups due today** counts it.
3. She opens the tile. The row reads `due Aug 31, 2026, 8:00 PM` - her pick, on
   her clock.
4. The alert rail carries **Follow-up due today** for that customer, because the
   sweep bucketed it on the dealership's day too.

## Requirements

- The due-today count and the due-today list read the same boundary.
- The alert sweep reads that same boundary.
- No server render turns an instant into words.
- The boundary is correct on the two days a year the clocks move.

## User Stories

- As a service advisor, I want a follow-up I set for the end of my shift to be
  on today's board, so that I do not lose it to a midnight that happens in a
  timezone I have never been to.
- As a service advisor, I want a due date written in my own time, so that I can
  tell at a glance whether I still have time to make the call.

## Acceptance Criteria

- Given the server in UTC and the advisor in America/Chicago, when she has a
  follow-up due at 8pm her time, then it is counted in **Follow-ups due today**,
  listed under that tile, and carries a `FOLLOW_UP_DUE` alert.
- Given a follow-up due at 10pm yesterday her time, when she reads the Overdue
  tile, then the row says `due Aug 30, 2026, 10:00 PM` and not the server's
  rendering of the same instant.
- Given a due date on either day the clocks move, when the dealership's day is
  computed, then it ends at 23:59:59.999 local on that day and not an hour out.
- Given `DEALERSHIP_TIME_ZONE` unset or blank, when a boundary is computed, then
  it uses `America/Chicago` rather than the server's clock.

## Edge Cases

- **The clocks move.** The offset in force at the end of the day is not always
  the one in force now, so it is read twice.
- **Zones that are not whole hours behind UTC.** `Asia/Kolkata` (+05:30) and
  `Pacific/Kiritimati` (+14) are in the test, because an offset that is read
  rather than assumed has no special cases.
- **Before hydration.** `LocalTimestamp` renders `…` in the server pass rather
  than a time that would visibly change once the page hydrates. The instant is
  in the markup either way, as the `<time>` element's `dateTime`.
- **An advisor outside the dealership's zone.** She reads the follow-up in her
  own time and the store counts it on the store's day, so the two can disagree
  for the hours between the two midnights. Deliberate; see the decision log.

## Data Requirements

None. No schema change, no migration, no new write. One new environment
variable, `DEALERSHIP_TIME_ZONE`, documented in `README.md` and `.env.example`.

## Analytics / Success Metrics

No live usage metrics; the product has no real dealership traffic.

- Expected outcome: an evening follow-up appears on the board and in the alert
  rail on the day it was set for.
- Signal to watch after launch: follow-ups that go from open to overdue without
  ever having been counted as due today. Before this, every evening follow-up in
  a negative-offset dealership did exactly that.

## Risks

- **A wrong `DEALERSHIP_TIME_ZONE` is silent.** It defaults rather than
  failing, so a deployment that never sets it keeps the Central day. Right trade
  for one dealership, wrong one the day there are two.
- **Two "todays" now live in `getCommandCenterData`.** `dueDayEnd` is the
  dealership's, `todayStart`/`todayEnd` are the server's. Named apart and
  commented, but a future reader can still reach for the wrong one.
- **The render rule is a source scan, not a type.** Nothing stops a server
  component formatting a date except `tests/dealership-day.test.ts`, which fails
  on any non-client file that calls `toLocaleDateString`, `toLocaleTimeString`,
  `formatTimestamp`, or `toLocaleString` on a value the schema names like a
  moment.

## Open Questions

- Does the dealership's day want to start at opening time rather than midnight?
  A follow-up due at 2am is meaningless in a shop that opens at nine. Not asked
  here, because midnight is what the product already implied and changing it
  moves rows off the board.

## Implementation Notes

- `src/lib/dealership-day.ts` computes the boundary from
  `Intl.DateTimeFormat`'s own reading of the zone rather than taking a new
  dependency for it. `hourCycle: "h23"` rather than `hour12: false`, which
  renders midnight as hour 24 on some runtimes and would push every boundary a
  day out.
- `tests/dealership-day.test.ts` carries the unit tests and three tripwires: the
  metric and its list must read the same boundary, the sweep must read it too,
  and no non-client file may print a moment. All three fail on the code as it
  was before this change.

## Portfolio Notes

Two defects with one symptom - an advisor reads the wrong day - and two
different causes. The storage half was fixed first and separately; folding this
in would have hidden the fact that fixing storage is what made these visible,
because the two errors had been cancelling.

The product decision worth defending is that "use the viewer's timezone", the
obvious answer, is wrong for two of the three surfaces. A background sweep has
no viewer, so the question becomes: whose day is a dealership's day? Answering
it deliberately is also what turns the leftover disagreement - printed on her
clock, counted on the store's - into a documented design instead of the next bug
report.
