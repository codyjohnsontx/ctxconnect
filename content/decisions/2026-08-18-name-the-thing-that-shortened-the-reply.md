# Decision: Name the Thing That Shortened the Reply

## Date

2026-08-18

## Status

Accepted

## Context

Making the length guard encoding-aware changed what the refusal can say. The old
sentence had one number in it because there was one limit:

> That reply is 140 characters too long to send as a text. Trim it to 1600
> characters or fewer.

There are two limits, and which one applies depends on what is in the box. A
reply carrying an emoji or a pasted curly apostrophe is capped at 700 characters
rather than 1600. So the advisor can now be told "trim it to 700 characters or
fewer" about a reply no longer than ones she sent all week, with nothing on
screen accounting for the difference.

The day before, we
[declined to build a segment counter](./2026-08-17-refuse-long-replies-without-teaching-sms-segments.md)
on the grounds that per-text cost is a number she cannot act on. One of the
things given up there was named explicitly: "the emoji surprise". This is that
surprise arriving somewhere it cannot be ignored, because now it stops a send.

## Options Considered

1. **Show the number only.** "Trim it to 700 characters or fewer." Correct, and
   silent about why 700.
2. **Add one sentence naming the cause.** "An emoji or special character in it
   shortens what one text holds."
3. **Name the character responsible.** The guard finds it, so it could be quoted
   back: "the 😀 in it shortens…".

## Decision

Option 2. When the encoding is what moved the limit, the refusal carries one
extra sentence naming that, in plain words. When it is not - an ordinary reply
simply past 1600 - the sentence is not there, and the refusal reads exactly as
it did before.

## Reasoning

Option 1 fails the test the earlier decision set for itself. That decision kept
the refusal and cut the counter because the refusal *changes what she does* and
the counter does not. A bare "700" fails that test too: the action it implies -
cut 200 characters out of a reply that answers the customer - is not the only
action available, and probably not the right one. The cheaper fix is to replace
one character. She cannot choose that if nothing tells her the character is
there.

Option 3 was tempting and is worse. The characters that trigger this are mostly
ones she cannot see: a curly apostrophe next to a straight one, a non-breaking
space out of a paste, an accent on the wrong vowel. Quoting a glyph she cannot
distinguish, or that renders as nothing at all, reads as the software
malfunctioning. Describing the class is honest about what is known and stays
readable whatever is actually in there.

This is not the segment counter arriving by the back door. The counter was a
standing number under an ordinary reply. This is one sentence that appears only
when a send has already been refused, and it explains that refusal.

## Tradeoffs

- **Given up: a one-line refusal.** It is three sentences now in the encoding
  case, under a box where attention is short. Accepted because it only appears
  when she is already stopped and reading.
- **Given up: precision about which character.** She is told the class, not the
  culprit, and still has to find it. The alternative was naming something
  invisible.
- **Still not given: the emoji surprise below the limit.** A curly quote in a
  200-character reply still triples what it costs the dealership, silently. That
  remains a manager's number, and remains unbuilt.

## Portfolio Notes

The useful bit is that a prior decision was re-opened rather than either
defended or quietly discarded. The 2026-08-17 call cut a feature for a stated
reason - "no action behind it" - and that reason held everywhere except one
case, which was itself listed in that decision's tradeoffs as a known cost. When
the cost showed up, the fix was to satisfy the original test in the one place it
now failed, not to reverse the decision. A decision log is what made that
possible: the reasoning was written down, so it could be checked against a new
case instead of re-argued from scratch.
