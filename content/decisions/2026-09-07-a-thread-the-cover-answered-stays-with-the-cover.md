# Decision: A Thread the Cover Answered Stays With the Cover

## Date

2026-09-07

## Status

Accepted

## Context

Coverage hands an advisor's open conversations to a colleague while she is away.
The question this decision answers is what happens on the day she comes back.

The obvious answer is "she gets them all back" - it is her book, she is here
again, put it back the way it was. That is the answer the account record
supports most simply, and it is the one every reviewer reaches for first.

It is wrong for the customer. A thread the cover has been answering for a week
is a live exchange between the customer and the cover. Handing it back is a
second change of voice on the same conversation - and one change of voice with
nobody explaining it is precisely the harm coverage exists to prevent. Doing it
twice is worse than never having covered at all.

## Options Considered

1. **Everything returns.** Simplest, one `updateMany`, no per-thread decision.
   Reverses the account cleanly.
2. **Nothing returns; the advisor comes back to an empty queue and picks up new
   work.** Also simple, and the customer is never handed around. But it turns
   every holiday into a permanent hand-over, which is the design the owner
   explicitly ruled out.
3. **Split by evidence: what the cover answered stays, what she never touched
   returns.** A per-thread decision, and a rule somebody has to maintain.
4. **Ask the advisor thread by thread on the day she returns.** Most accurate,
   and it makes coming back from holiday a data-entry task.

## Decision

Option 3. On return, a conversation stays with the cover if anyone other than
the returning advisor has sent the customer a reply on it since coverage began.
Everything else goes back. The advisor is not asked; the app can already see who
has been talking to whom.

Three things are deliberately excluded from "replied":

* **Internal notes.** The customer never saw one, so nothing about the
  conversation changed for them. A cover who read a thread and left herself a
  reminder has not taken it over.
* **The returning advisor's own replies.** She can reach her own thread through
  her department, or after being switched back on. Her own voice on her own
  conversation is not somebody covering it.
* **Replies from before coverage began.** A colleague who happened to answer
  once last month is not this coverage. This is why `User.coveredSince` is
  written with `User.coveredByUserId` and never without it.

One thing is deliberately included: a reply that **failed to send**. The
customer never saw it, but the cover is mid-fix on it with the delivery banner
in front of her, and handing the thread back drops the retry along with the
work. "The customer saw it" is the reason a note is excluded; it is not the test
for whether the cover has taken the thread on.

Two related calls, made for the same reason:

* **Deactivating an account does not arrange coverage by itself.** It would make
  one decision quietly into two, and force deactivation to fail when nobody
  suitable exists. The Settings row names the stranded conversations instead and
  links to the board.
* **Reactivating an account does not end coverage by itself.** Ending coverage
  permanently changes who owns some conversations, and that must not ride along
  on a status toggle - especially on an accidental deactivate-then-reactivate
  bounce. Handing threads *back* to a switched-off account is refused outright,
  which makes reactivate-then-end the only correct order and says so on screen.

## Reasoning

The feature exists to stop a customer being abandoned mid-thread. A rule that
reverses the hand-off wholesale would abandon them a second time, on the day the
app is supposed to be putting things right. Splitting by evidence costs one
tested function and gives the advisor back everything that was genuinely still
hers.

It is also the rule that needs no one to remember anything. Nobody has to note
which threads the cover took on; the messages already say.

## Tradeoffs

* An advisor comes back to a book that is not quite the one she left. Some
  customers are now her colleague's. The board and the in-thread notes say which
  and why, and she can hand any of them back by hand.
* The rule runs once per advisor per trip, on a page nobody is watching, so a
  regression in it would surface months later as a customer being passed back and
  forth. That is why it is a pure function - `coverageOutcome` in
  `src/lib/coverage.ts` - with the action loading only the coverage window and
  letting it decide the rest, and why `tests/coverage.test.ts` pins each of the
  five conditions separately.
* Counting a failed reply is a judgement call that could go the other way. It is
  written down here and pinned by a test rather than left to be rediscovered.

## Portfolio Notes

The interesting part of this decision is that the simple answer and the correct
answer differ, and the difference is only visible if you ask what the customer
experiences rather than what the account record should look like. "Put it back
the way it was" is a database instinct. "Do not change the voice on a live
conversation twice" is a product one, and it is the one that decides the rule.

The second thing worth saying is what was refused: coverage is not wired into
deactivation, and it is not wired into reactivation, because bundling an
irreversible change of ownership into a status toggle hides it. One decision,
one button, and the screen that creates the gap is the screen that names it.
