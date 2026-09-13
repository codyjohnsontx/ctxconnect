# Decision: The Sweep Quotes the Customer's Latest Text

## Date

2026-09-12

## Status

Accepted

## Context

Earlier the same day the owner decided that the rail shows a copy of an unowned
thread's alert that quotes the customer over the sweep's generic "is waiting
without an owner" copy, and the latest text over an earlier one
([An Alert Ranks Where Its Subject Ranks](./2026-09-12-an-alert-ranks-where-its-subject-ranks.md)).
That rule chooses between stored copies, and one case has no quoting copy to
choose.

A thread the customer texted while it had an owner holds only alerts addressed to
that owner. When a manager sets it unassigned, `updateConversation` withdraws the
unowned-thread copies, and nothing raises that type again with the customer's
words. So until the customer texts again, managers see only the sweep's generic
copy. Reproduced on a seeded dealership: a parts thread was texted twice through
the signed webhook while it had an owner, the GM set it unassigned, and the
Command Center read "Marco Silva is waiting without an owner."

A second recorded gap had the same cause. The rail reads a bounded number of rows
before collapsing them, and the sweep's generic copy is newer than the webhook's.
Enough same-rank rows between them could push the quoting copy out of the scan
and bring the generic line back.

## Options Considered

1. **Accept it.** The customer's words come back with their next text.
2. **Have the operational sweep quote the latest inbound text** whenever it raises
   an unowned-thread alert, and record that text on the row.

## Decision

Option 2, the owner's call on 2026-09-12.

## Reasoning

Option 1 leaves a manager reading "waiting without an owner" on the thread a
colleague has just handed back, when what the customer asked is the thing that
decides who picks it up. Option 2 also closes the scan-limit gap without touching
the read side: once the sweep's own copy quotes the customer, it no longer
matters whether the webhook's copy made it into the scan. Rows written before the
change are the exception, see Tradeoffs.

The cost lands on the busiest path in the app. The sweep runs on every Command
Center load, and the rank decision earlier that day relied on its steady state
writing nothing. So the change was held to three rules.

- **One statement, not one per thread.** On the seeded dealership a Command
  Center load went from 296 statements to 297, with 0 rows written in the steady
  state before and after. A Prisma `include` with `take: 1` was the obvious way
  to write it and was rejected. The database log showed Prisma binds no LIMIT for
  a nested take and trims in memory, so it would read every inbound text on every
  unowned thread on every load. The statement instead walks each thread's
  `(conversationId, createdAt)` index from the newest end and stops at the first
  text the customer sent. Against a 50,000-message thread its plan was a backward
  index scan under `LIMIT 1`.
- **No writes when nothing changed.** Before writing, the sweep looks for its row
  by every stored column, the text included. Quoting the newest text keeps that
  match stable from one load to the next. On a thread the webhook raised, it
  matches the webhook's own row, so the sweep no longer adds its generic line
  beside it. Two texts stamped the same instant are ordered by id, so the answer
  cannot flip between loads. The rail and a hand-off settle that same tie the
  same way (`laterCopy`), and the query compares ids byte by byte as JavaScript
  does, so a copy dated by its text never shows a text the sweep would not have
  quoted. Found by a second review, after dating copies by their text made such
  ties reachable.
- **One constructor for a quote.** `quotedCustomerText` builds the quoted body,
  the text it names and that text's time together, and the webhook and the sweep
  both use it. The rail takes a stored text id to mean the row quotes that text,
  so the two must not be set apart, and it orders copies by their time, so the
  time comes from the same text.

## Tradeoffs

- One more statement per Command Center load while any thread is unowned, and
  none otherwise.
- Rows written before the change keep their generic wording. On a thread the
  customer has texted, the first load after the change writes a quoting copy per
  manager beside each generic copy, once. The rail shows the quoting copy. The
  generic rows are resolved by whatever ends the alert, not here. Because the
  quoting copy is dated by its text (below), it sorts behind the newer generic
  copy, so on those threads the earlier scan-limit gap still applies: enough
  same-rank rows can push the quoting copy past the rows a list reads (60 on the
  rail, 300 on the Command Center) and bring the generic line back, until the
  alert ends. After the change the sweep writes a generic copy only for a thread
  the customer has never texted, so no new pair arises.
- A copy that quotes a text prints and orders by that text's time, not by when
  the row was written. A generic copy keeps its write time. This was first left
  open as a product question and was settled by a race found in review. The
  sweep reads a thread, a new text lands and the webhook writes its copy quoting
  it, and then the sweep writes its copy quoting the older text. The rail shows
  the later of two copies quoting different texts, so dated by their writes the
  older quote won, and every later sweep matched the webhook's row and wrote
  nothing to correct it. Dated by their texts, the older quote is the earlier row
  whichever copy is written last. The cost is that an alert the sweep raises
  hours after the last text prints that text's age and lists by it within its
  rank, as the webhook's copy of that text already did. On a rank with more than
  60 newer rows it can sit behind the rail's "more in Command Center" row, which
  is the scan-limit issue filed separately.
- A picture sent with no caption is still the latest thing the customer sent,
  so it is what the alert reports: "Marco Silva sent a photo or file." A message
  that is only whitespace reads "sent a blank text." Skipping past it to older
  words would misstate what the customer said last, and quoting its empty body
  wrote "Marco Silva: " with nothing after it. The inbox had no wording of its
  own for such a message to reuse. Found by the same second review.
- The seeded demo moves. Its unassigned sales lead now shows the customer's own
  question instead of a generic line.
- The suite has no database, so it cannot prove the query. The unit tests run the
  sweep's draft, the quote constructor, the row a draft becomes, and which copy
  the rail shows when an older quote is written after a newer one. Three things
  only a real local Postgres proved, because the suite cannot observe them: that
  the statement returns the newest of several texts, that a steady-state load
  writes nothing, and the race order end to end. That gap is filed as
  ctx-no-way-to-test-database-semantics.

## Portfolio Notes

The product call was one sentence, "show the customer's words", and it landed on
the one job that runs every time a manager opens the Command Center. The work was
treating the query budget as part of the requirement: measuring before and after,
and dropping the idiomatic `include` once the database log showed it would read
everything.
