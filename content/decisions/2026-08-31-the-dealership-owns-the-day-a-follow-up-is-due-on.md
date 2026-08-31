# Decision: The Dealership Owns the Day a Follow-Up Is Due On

## Date

2026-08-31

## Status

Accepted

## Context

Three Command Center surfaces read a follow-up's due date on the server's clock,
which is UTC on Vercel and is nobody's clock:

1. the printed due date on a focus row, `task.dueDate.toLocaleString()` in the
   server render;
2. the **Follow-ups due today** metric and the list behind it, bucketed
   `gte: now, lte: endOfDay(now)`;
3. the sweep that raises `FOLLOW_UP_DUE`, bucketed the same way with
   `setHours(23, 59, 59, 999)`.

All three were masked until 2026-08-31. `createTask` wrote a bare wall clock, so
an advisor's 8pm Central pick was stored as `20:00Z` - wrong instant, but read
back on the same wrong clock it printed her pick and fell inside the server's
day. Fixing the write
([A New Follow-Up Lands on the Day She Picked](../prds/2026-08-31-a-new-follow-up-lands-on-the-day-she-picked.md))
stores the instant she meant, `2026-09-02T01:00Z`, and the three readers now
show what they always said.

Reproduced with the server in UTC and the browser in America/Chicago: a
follow-up she set for last night at 10pm printed as **due 8/31/2026, 3:00:00
AM**, the wrong day; one she set for tonight at 8pm was missing from a metric
reading **1** instead of 2, and had no alert row at all.

Two of those are a rendering. The third is a query, and a sweep run from a cron
has no viewer to ask what day it is. So the question is not only how to fix it -
it is whose day the fix should use.

## Options Considered

1. **The viewer's own day, everywhere.** Send the browser's timezone to the
   server and bucket with it.
2. **The dealership's day for the buckets, the viewer's clock for the printed
   moment.**
3. **The dealership's day for everything, printed moment included.**

And, for where the dealership's zone comes from:

1. **A `DealershipSettings.timeZone` column**, with a settings control.
2. **A `DEALERSHIP_TIME_ZONE` environment variable** with a default.

## Decision

Option 2: the **dealership's** day decides which follow-ups are due today and
which raise an alert; the **viewer's** clock decides how a due date is printed.
The zone is configuration - `DEALERSHIP_TIME_ZONE`, defaulting to
`America/Chicago` - read by `src/lib/dealership-day.ts`, which both the
Command Center query and the alert sweep call.

## Reasoning

**Why not the viewer's day.** The sweep has no viewer, so option 1 cannot answer
for it at all - it would need a second rule, and a second rule is how the metric
and the alert rail come to disagree on the same screen. It also gets the
travelling case backwards: an advisor whose laptop is still set to the zone she
flew in from should be shown her store's board, not her laptop's. A dealership
is one physical building where everyone shares one working day.

**Why not the dealership's clock for the printed moment.** She reads a time to
decide when to make a call, and the clock she checks that against is on her own
wrist. `LocalTimestamp` already existed for exactly this on Settings.

The two therefore disagree by design, and that is the correct answer rather than
a compromise: the store counts the follow-up on the store's day, and she reads
it in her own time. They only visibly differ for an advisor outside the store's
zone, and only for the few hours between the two midnights.

**Why configuration and not a column.** Attend serves one dealership -
`DealershipSettings` has a single row with a hard-coded id. A column would need
a migration, a settings control and a product decision about who may change it,
all to record something that changes when the business moves premises. The env
var can become a column the day a second dealership exists, and
`dealershipTimeZone()` is the only place that would change.

## Tradeoffs

- **A wrong `DEALERSHIP_TIME_ZONE` is silent.** It is a default rather than a
  required variable, so a deployment that never sets it keeps the Central day
  rather than failing to boot. That is the right trade for a single-dealership
  product and the wrong one for a multi-tenant one.
- **The store's midnight is not a UI anyone can see.** An advisor an hour ahead
  of the dealership can read a follow-up as due today and find it counted
  yesterday. Naming the timezone on Command Center was considered and cut: it is
  chrome on every load to explain an edge no single-site dealership hits.
- **Two "todays" now live in `getCommandCenterData`.** The message-volume and
  response-time windows still run on the server's day. Left deliberately - it is
  a different question about a different clock, and folding it in would widen a
  defect fix into a rewrite of the analytics window.

## Portfolio Notes

The interesting part is that "use the viewer's timezone" is the obvious answer
and is wrong for two of the three surfaces. A background sweep has no viewer, so
the question stops being an implementation detail and becomes a product one:
whose day is a dealership's day? Answering it deliberately is also what makes
the remaining disagreement - printed time versus counted day - a documented
design rather than an unnoticed inconsistency waiting to be filed as a bug.
