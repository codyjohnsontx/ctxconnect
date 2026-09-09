# Decision: A Note Attend Wrote Itself Is Not Somebody Answering

## Date

2026-09-09

## Status

Accepted

## Context

The breach alert tells a manager that a customer texted and nobody has seen to
them since. It decided that by asking whether anything on the thread came after
the customer's last message.

Coverage broke it. Handing an advisor's book to a colleague writes an internal
note on every thread it moves, so arranging coverage withdrew the breach alert
on exactly the threads it had been raised for - while the customers were still
waiting, at the moment a manager most needs those alerts, because somebody is
away and threads are changing hands.

The mechanism was not new. An ordinary hand reassignment writes the same kind of
note and has quietly done the same thing since long before coverage existed.
What coverage changed was the scale: one alert on one thread became an advisor's
whole book at once, which is what made it visible.

## Options Considered

1. **Count only replies to the customer.** One line, no schema change: an
   internal note stops clearing the alert.
2. **Mark the notes Attend writes itself, and skip only those.** Costs a column.
3. **Stop writing in-thread notes when a conversation changes hands.** Removes
   the per-thread trail that says who holds this customer and why.
4. **Leave it.** The mechanism predates coverage, so treat it as out of scope.

## Decision

Option 2. `Message.systemGenerated` marks a row Attend wrote on its own behalf.
A thread counts as attended when the newest message after the customer's last
text is a reply, **or** an internal note written by a person.

Every site that writes a note on Attend's behalf sets it - coverage starting,
both endings, and ordinary hand reassignment, which is where this lived first.
A note a person types is deliberately left unmarked.

## Reasoning

Option 1 is the cheap one and it is wrong. An advisor who writes "called her,
left a voicemail" has done the work, and an alert that kept shouting through
that would send a manager to chase an already-chased customer. Narrowing to
replies would have thrown that away along with the bookkeeping.

The distinction that matters is not reply-versus-note. It is **a person
recording action** against **the system recording an event** - and nothing about
the shape of a message implies which one it is. Only a mark on the row can carry
it, which is why this costs a field.

Option 3 would have paid for the fix with the audit trail, which is the wrong
currency. Option 4 was rejected because although the mechanism predates
coverage, this feature is what turns it from one thread into a whole book.

## Tradeoffs

* A column on `Message`, and a rule every future writer of a system note has to
  remember. `tests/sla.test.ts` scans the server actions for an unmarked note so
  a forgotten site fails there rather than in a manager's alert list.
* **Existing rows are left unmarked, which reads them all as written by a
  person.** Deliberate, not a default nobody thought about. Attend cannot tell
  after the fact which historical notes it wrote - the marker is what would have
  said so - and marking them all as system-written would retroactively reopen
  breach alerts across months of settled threads and flood the board with
  history nobody can act on. Today's behaviour is kept for old data and the new
  rule applies from here, where the mark is truthful. The reason is written
  beside the migration as well as here.
* The rule moved out of `src/lib/notifications.ts` into `src/lib/sla.ts` so it
  can be executed by a test. The sweep that asks it runs on a cron with nobody
  watching, and a rule nobody can run is a rule nobody can check.

## Portfolio Notes

The useful part is that the cheapest correct-sounding fix was the wrong one, and
what exposed it was a single concrete case: the voicemail note. "Only replies
count" reads as obviously right until you ask what it costs, and it costs the
advisor who did the work by phone.

It is also a good example of a bug whose blame and whose scope differ. The
defect predated the feature that surfaced it, and the argument for fixing it
here was not "we broke it" but "we made it matter."
