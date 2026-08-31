# PRD: Find a Customer From the Inbox

## Status

Built

## Date

2026-08-31

## Summary

Attend held every conversation the dealership had ever had and offered no way to
search any of it. The advisor could filter by department, status, assignee, tag
and three checkboxes - none of which narrows to a person - and then scroll. One
box above the queue now finds a conversation by customer name, by phone number
in any format, or by something said in the thread.

## Problem

There was no search anywhere in the product. Grepping for one turns up nothing:
the inbox has `filterWhere`, the Customers page has no controls at all, and the
Tasks page has status tabs.

The filters cannot answer the question an advisor actually asks. Every one of
them narrows to a *category* - Service, Waiting on staff, assigned to Dana - and
the question in front of her is about a *person*: Renee is on the phone asking
about her warranty claim, and the thread is somewhere in the queue.

Reproduced in the running app as the service advisor against the seeded
dealership. Finding a specific customer meant reading down the ranked queue.
That is workable at sixteen seeded customers and it is the whole job at a real
store, where the queue is hundreds of rows deep with no pagination.

The consequence is not slowness, it is a phone call the advisor cannot answer
while the customer is still on the line.

## Target User

The service advisor with a customer in front of her or on the phone. She knows
one of three things: the name they just gave, the number on the caller ID, or a
phrase she remembers texting them.

## Goal

She can get to the right conversation from any one of those three, in one press.

## v1 Scope

**One box, three ways in.** `src/lib/search.ts` builds a Prisma clause matching
the customer's name, the customer's phone, or any message body in the thread.
Name and body are matched case-insensitively; phone is matched on digits.

**Phone is matched on digits alone.** Numbers are stored in E.164
(`+15125550110`) and read aloud in every other format, so `(512) 555-0110`,
`512.555.0110` and the last four off a caller ID all have to find the same
customer. Anything under three digits is treated as noise rather than a number,
because two digits match most of the dealership.

**A typed `%` or `_` is searched for literally.** Found while driving the box:
Prisma's `contains` reaches Postgres as a LIKE/ILIKE pattern with nothing
escaped, so typing `%` returned the entire queue - which reads as a search that
ignored her, not as one that found nothing. `escapeLikeWildcards` escapes `%`,
`_` and the backslash itself, which is Postgres's own default LIKE escape
character and would otherwise consume the character after it.

**The search AND-s onto the queue, it never joins its OR.**
`conversationQueryWhere` composes the reader's scope, her filters and her search
as three AND-ed clauses. This is the part that matters for correctness rather
than convenience: the scope clause is what decides which threads she may open at
all, and the filters own a top-level `OR` of their own - that is what
`needsAction` is - so a search merged into the filters would widen the queue she
narrowed and could reach past her scope. Composition lives in the tested module
rather than in `getInboxData`, and the test asserts the scope survives every
kind of term.

**A row matched on message text says which message.** The queue row previews the
*newest* message, which after a search is often not the matching one, and a hit
whose preview does not contain the term reads as a result the search invented.
A second query fetches the newest matching message per conversation - over ids
that came from the already-scoped list, so it needs no scope of its own - and
the row shows an excerpt centred on the match. Only when the preview does not
already carry the term.

**Searching and filtering compose in both directions.** The search form carries
the active filters forward as hidden inputs, and the filter form carries the
search term. Pressing one does not throw away the other.

**One way out, and it keeps her place.** `Clear search` drops `q` and keeps the
filters, the open thread and the back-link origin. The empty state names the
term that came up empty and offers the same link, because a search that returned
nothing behind a filter she forgot about is the one dead end an advisor reads as
"the customer isn't here".

## Non-Goals

- **Search anywhere but the inbox.** The Customers page and the Tasks page still
  have no search. The inbox is where the advisor lives and where the customer is
  found; the others follow.
- **Ranking by relevance.** Results keep the queue's own ranking. A name match
  and a body match sit in whatever order the AI pass put them.
- **Fuzzy matching, stemming or typo tolerance.** Substring only. "Renee" finds
  Renee; "Rene" finds her too; "Renae" does not.
- **Full-text indexes.** `ILIKE '%term%'` cannot use a b-tree index, so this is
  a sequential scan bounded by the same unbounded queue query that already
  exists. At demo scale it is invisible. A real store needs `pg_trgm` or a
  tsvector column, which is a migration and a decision, not part of adding the
  box.
- **Pagination.** The queue still has no `take`; searching narrows it rather
  than paging it.

## Acceptance Criteria

- Given the advisor types part of a customer's name, when she presses Search,
  then only conversations with that customer are listed and the header says how
  many matched.
- Given she types a phone number with punctuation, or the last four digits off a
  caller ID, then the same customer is found.
- Given she types a phrase from a message rather than a name, then the
  conversation is listed with the matching line quoted under the preview.
- Given she types `%`, then the queue is not widened - only conversations
  containing a literal `%` match.
- Given a conversation in a department she cannot read, when she searches for
  that customer's name or anything said in that thread, then it is not listed.
- Given a filter is already applied, when she searches, then both narrowings
  apply, and each has its own way out.

## Risks / Open Questions

- **`ILIKE '%…%'` does not scale.** Named as a non-goal above, and it is the
  first thing that will hurt on real data. The module boundary is where the
  replacement goes: `conversationSearchWhere` is the only thing that would
  change.
- **A message-body match can surface an internal note.** That is deliberate -
  notes are part of the thread's history and she wrote them - but it means a
  search can match on text the customer never saw.
- **No search history and no suggestions.** She retypes each time.
- **Escaping is verified by unit test, not against Postgres.** The test pins the
  escaped string that reaches Prisma. What Postgres does with `\%` is its
  documented default rather than something this repo can assert without a
  database, and it was driven by hand in the running app.
- No live usage metrics. The signal to watch is whether the box is used with
  digits or with words - if it is mostly digits, the caller-ID case is the one
  to optimise.

## Portfolio Notes

The feature is table stakes; the interesting part was in the two places it could
have been quietly wrong.

The first is the wildcard. `contains` looks like a substring search and is a
pattern match, so the product had a hidden operator in its search box that only
appears if you type the right punctuation. It was found by typing `%` into the
box on purpose rather than by reading the code.

The second is where the search clause is attached. Merging it into the filter
object is the shorter diff and reads fine, and it puts a user-supplied OR next
to the clause that decides which threads she may read. AND-ing is not a style
preference there; it is the difference between a search and a permission bug.
