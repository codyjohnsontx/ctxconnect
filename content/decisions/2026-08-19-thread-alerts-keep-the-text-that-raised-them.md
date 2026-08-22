# Decision: Thread Alerts Keep the Text That Raised Them

## Date

2026-08-19

## Status

Accepted

## Context

An unowned thread is raised as an alert by two writers: the Twilio inbound
webhook, the moment a text lands, and the operational sweep, on every Command
Center load. Each assembled the row's id columns its own way, and they differed
about one of them - the webhook hung the inbound message on the row, the sweep
had none to hang. So one thread was stored under two fact keys, and the alert
rail listed the same customer twice.

That was closed at the read side: an unassigned-conversation alert is about the
thread by definition, so the message came out of the key and the two rows now
collapse to one. Nothing at the write side stopped the two writers drifting
apart again, and the next divergence would surface as a different symptom and
cost the same afternoon to trace. This decision is about closing it there.

## Options Considered

1. **Stop storing the message on a thread alert at all.** One fact becomes one
   row per recipient. The column would then mean exactly one thing everywhere,
   and the shapes could not differ because there would be nothing left to
   differ about.
2. **Keep the raising text, but name it apart from the message that is part of
   a fact.** The row still records which text it came from; that name is not
   the one the key reads, and the type refuses to let a thread alert use the
   one that is.
3. **Declare the two writers legitimately different and change nothing.** The
   read side already collapses the rows, so the advisor sees one alert either
   way.

## Decision

Option 2.

## Reasoning

Option 1 was the smaller change and bought something option 2 does not: it
bounds the rows a busy thread accumulates, because there would be one row per
recipient instead of one per inbound text. It was rejected because collapsing
those rows is not invisible. The Command Center previews an alert's text, and
the alert carries a time; with one row per thread it would preview the first
unanswered text instead of the latest, and read as old as the thread rather
than as recent as the last thing the customer said. Those are things a person
sees on a screen, and this work was scoped to be structural only - the whole
point was to change the shape of what is written without changing what anyone
reads.

Option 3 is the position that produced the defect. Two writers free to invent
their own shape will invent a third, and the read side can only collapse
divergences it has been taught about in advance.

So the fact and the provenance are separated by name rather than by discipline.
The text a thread alert was raised from is still stored, under a name the key
does not read, and the name the key does read is unavailable on that shape. The
original bug is now a compile error rather than a convention, and the rows a
thread holds are exactly what they were before.

## Tradeoffs

- **The row growth option 1 would have fixed is untouched.** A thread still
  collects an alert per inbound text and holds them until it closes, so one busy
  thread can crowd others out of a scan. The bound belongs on the write side,
  where an answered thread should stop holding an alert per text, and it stays
  filed separately. Choosing option 2 means paying for it separately rather than
  getting it as a side effect.
- **The two writers still produce different rows.** They now differ only in
  provenance and in wording, priority and due time. Unifying those would change
  the rail's copy and the order it lists alerts in, which is the user-visible
  change this work was not allowed to make.
- **One divergence with a consequence is left standing.** Whichever writer
  creates a row first fixes that fact's priority, because an existing active row
  is returned rather than updated, and the two writers do not agree on priority.
  It is invisible to the key and to the badge, since priority orders rows rather
  than identifying facts. Pre-existing, deliberately unchanged here, and filed
  separately; the note lives on the function that causes it.
- **The fact, the badge and the rail are unchanged.** Checked rather than
  assumed: the old writers and the new ones were run against the same freshly
  seeded database and the stored rows, the distinct fact keys, the rail's
  representative rows and both badge counts came out identical.

## Portfolio Notes

The decision worth defending is the one that cost more code. The simpler option
was also the one that quietly fixed a second problem, which is exactly what
makes it tempting; it failed on a constraint that had nothing to do with either
problem, because it would have changed what an advisor reads on a screen while
the work was supposed to be invisible to her. Splitting the column's two
meanings by name kept the visible behaviour byte-identical and left the second
problem to be paid for on its own terms, where it can be judged as a change to
what she sees rather than smuggled in as a refactor.

Related: [PRD - One Alert Per Thing That Needs Doing](../prds/2026-08-17-one-alert-per-thing-that-needs-doing.md).
