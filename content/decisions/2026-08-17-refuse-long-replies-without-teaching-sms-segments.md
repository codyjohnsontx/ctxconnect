# Decision: Refuse Long Replies Without Teaching SMS Segments

## Date

2026-08-17

## Status

Accepted

## Context

The reply box said nothing about length. Two separate facts were invisible to the
service advisor:

1. **A reply over 1600 characters would be refused.** It was accepted by the box,
   Send stayed enabled, and the refusal arrived after the press as `Invalid
   message payload.` - the same response a malformed request gets, and
   indistinguishable from broken software.
2. **A reply can arrive as several separate texts.** A carrier splits past 160
   GSM characters, and a single emoji or curly apostrophe drops the budget to 70,
   so one pasted quotation mark can turn one text into three. The dealership is
   billed per part.

A prior exploratory branch fixed both, adding a GSM 03.38 segment counter across
179 lines of library code and 218 lines of tests, which put a line under the box
reading "Sends as 3 separate texts. An emoji or special character is shortening
every one."

The question was whether to keep the second half.

## Options Considered

1. **Take both.** The refusal and the segment counter, as built.
2. **Take the refusal only.** Tell the advisor when a reply cannot be sent and by
   how much. Say nothing about how many texts a sendable reply becomes.
3. **Take neither.** Leave length alone as pre-existing behaviour.

## Decision

Option 2. The over-length refusal moves out of the Zod schema into its own check
with its own sentence, shown in the box before Send and repeated by the route.
The segment counter is not built.

## Reasoning

The two facts look similar and are not. The refusal changes what the advisor
does: she trims the reply, and she learns that from the box instead of from a
failed press. The segment count does not. There is no action behind it beyond
"write less" - and if the reply needs to be that long to answer the customer,
writing less is the wrong answer.

Per-text cost is a real concern, but it is the general manager's concern, not the
advisor's, and she has no budget to weigh it against. Putting it under her reply
box dresses a manager's metric as an advisor's affordance. The space under the
box is the last thing she reads before pressing Send; it should carry only what
changes that press.

Option 3 was rejected because the refusal was genuinely reachable and genuinely
unreadable. An advisor who hits it has no way to tell she wrote too much rather
than that Attend broke.

## Tradeoffs

- **Given up: visible per-message cost.** Nobody in the product can see that one
  reply became five texts. If per-text spend ever becomes a question worth
  answering, it belongs on a manager surface with totals over time, not under one
  reply box - and the arithmetic is recoverable from `aa4b05e` on the unlanded
  branch.
- **Given up: the emoji surprise.** A pasted curly apostrophe silently more than
  doubles the parts a reply costs. The advisor still cannot see that.
- **Kept: a much smaller surface.** ~30 lines instead of ~400, with no GSM
  alphabet table to keep correct.

## Portfolio Notes

The interesting part is declining work that was already written and passing its
tests. Sunk implementation is not a reason to ship something, and "technically
accurate and free" is not the bar - the bar is whether the person reading it can
do anything differently. Two facts that both look like "length information"
turned out to belong to two different users, and only one of them was standing in
front of the reply box.
