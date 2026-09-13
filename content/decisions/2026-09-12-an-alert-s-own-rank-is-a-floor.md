# Decision: An Alert's Own Rank Is a Floor

## Date

2026-09-12

## Status

Accepted

## Context

[An alert ranks where its subject ranks](./2026-09-12-an-alert-ranks-where-its-subject-ranks.md)
left three alert types with a rank of their own - `SLA_MISSED` URGENT,
`MESSAGE_FAILED` HIGH, `FOLLOW_UP_OVERDUE` HIGH - and that rank replaced the
subject's rather than setting a floor under it. The decision recorded that this
lowers a loud subject as well as lifting a quiet one, and filed whether the drop
was right as a product question of its own.

It is the harmful direction. An URGENT follow-up's alert read URGENT while the
follow-up was merely due and HIGH the moment it went late: the situation got
worse and the alert got quieter, on a rail that reads a bounded number of rows in
priority order.

Reproduced in the running app before anything was changed, against a seeded
dealership. An URGENT follow-up assigned to the service advisor, due at
04:41:31Z: a Command Center load at 04:37:46Z stored its `FOLLOW_UP_DUE` alert at
URGENT, and the load at 04:41:42Z withdrew that and stored `FOLLOW_UP_OVERDUE` at
HIGH. On the general manager's Command Center it listed seventh, below an URGENT
follow-up not due for another ten minutes, four missed response clocks and a new
customer message. After the change the same load stored it URGENT, re-ranked all
three of its copies, and listed it first on both rails.
The seed showed the same thing on its own data: its URGENT "Escalate GS warranty
claim" follow-up is overdue and was stored HIGH.

## Options Considered

1. **Keep the replacement.** The rank stays exactly what the event says.
2. **Make `FOLLOW_UP_OVERDUE` a floor, and leave the other two as replacements.**
3. **Make every event rank a floor.** The alert ranks at the higher of the
   event's rank and its subject's.
4. **Choose floor or cap per type.**

## Decision

Option 3.

## Reasoning

Each of the three, asked the same question - does replacing ever lower a loud
subject, and is that ever wanted:

- **`FOLLOW_UP_OVERDUE`** is the defect as reported. Going late is the follow-up
  getting worse, never better.
- **`MESSAGE_FAILED`** has the same shape. A reply that never reached the
  customer on an URGENT thread read HIGH, below the URGENT alerts about that same
  thread. The reason the rank exists - "urgent work on a thread nobody thought was
  urgent" - only ever argued for lifting. It is the same defect, so it is fixed
  with it rather than filed.
- **`SLA_MISSED`** carries URGENT, the top rank, so a floor and a replacement
  compute the same thing. Nothing changes for it.

No type wants a cap. A cap would say an event makes its thread or follow-up less
pressing than it already was, and none of these events does.

Option 2 fixes the report and leaves the same mistake one alert over. Option 4 is
machinery for a case nobody has. So the rule is one expression in
`notificationPriority` in `src/lib/notification-facts.ts`, and
`tests/notification-priority.test.ts` checks every alert type against every
subject rank: none ranks below its subject.

## Tradeoffs

- **The URGENT tier gets the alerts that were URGENT all along.** A late URGENT
  follow-up and a failed text on an URGENT thread now sit among the URGENT alerts
  instead of at the top of the HIGH ones, so a rail that reads a bounded number of
  rows has more URGENT alerts competing for it. That is the rail telling the truth
  about the subject's own rank, which the dealership chose.
- **Standing rows are corrected in two ways.** The sweep raises
  `FOLLOW_UP_OVERDUE` for every open overdue follow-up on each Command Center
  load, and a raise re-ranks every standing copy of its fact, so those converge on
  the next load. A migration lifts what the sweep does not reach: failed texts
  older than the 25 it reads, and resolved rows.
- **The demo rail changes where a subject is URGENT.** The seed ranks its own
  rows through `notificationPriority`, and none of its hand-written fixed-rank
  rows sit on an URGENT subject, so they are unchanged. The sweep-raised overdue
  alert on the URGENT warranty-claim follow-up now reads URGENT.
- **The rule compares ranks by the enum's declared order.** That is the order
  Postgres sorts the column in, so it is the order the rail already reads. The
  test writes that order out on its own rather than importing it, so reordering
  the enum fails the test rather than quietly changing the rule.

## Portfolio Notes

The earlier decision was honest about the flaw: it pinned the replacement in both
directions and filed the question instead of guessing at it. This is the answer.
It came down to one principle: a worse situation must never produce a quieter
alert. Checking the other two types against that principle turned one reported
bug into the one rule it belonged to, without widening into any other change to
how alerts rank.
