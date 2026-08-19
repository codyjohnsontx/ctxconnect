# PRD: The Length Guard Reads the Reply

## Status

Built

## Date

2026-08-18

## Summary

The reply box told the advisor a 900-character reply would send. With one emoji
in it, Twilio would have refused it. The guard held a single flat limit of 1600
characters, which is only the limit when every character is in the GSM-7
alphabet; one character outside it moves the whole reply to UCS-2, where the
limit is 700. The guard now reads the body, works out which alphabet Twilio will
use, and refuses against the limit that actually applies.

## Problem

`src/lib/sms-length.ts` capped a reply at 1600 characters and commented that
"Twilio refuses beyond this". That is true for GSM-7 only. Twilio picks the
encoding from the content, and any character outside GSM-7 - an emoji, a curly
apostrophe pasted out of an email, a customer name with the wrong accent on it -
moves the whole message to UCS-2, where one text holds 70 characters and the
body maximum is 700.

Reproduced against the pre-fix code in the running app, signed in as the service
advisor on the seeded Nina Caldwell thread. A 900-character reply beginning with
one emoji:

- The box showed no warning and Send stayed enabled.
- `POST /api/messages/send` passed the length check and went on to the carrier
  step, stopping only at `503 Texting is not connected for this dealership`.
  With texting connected, that body reaches `client.messages.create({ body })`
  at 900 UCS-2 characters against a 700-character maximum, and comes back as
  Twilio error 21617.

It is the same defect as the one the 2026-08-17 work exists to remove - Attend
asserting something it does not know - at a boundary that work did not model.
The blast radius is bounded rather than silent: a failed send is already marked
undelivered on the row and in the thread, so the advisor is misinformed about
what **will** send, not about what **did**.

## Target User

The service advisor. She is the one writing the reply, and the box is the last
thing she reads before pressing Send.

## Goal

What the box says about length is what Twilio will do, whatever she has typed
into it.

## v1 Scope

**The guard reads the body.** `src/lib/sms-length.ts` carries the GSM 03.38
alphabet - the basic set, plus the extension set whose characters cost two
septets each - and works out from the body which encoding Twilio will use, how
much of it would get through, and whether the encoding is what stopped it. Both
callers changed to one call, `smsTooLong(body)`, which returns the overage and
the sentence together or null, so the number under the box and the disabled Send
button cannot end up reading the body differently.

**The refusal names the lever, not a ceiling.** The old sentence always said
"trim it to 1600 characters or fewer". That is wrong twice over: for a reply
carrying an emoji the ceiling is 700, and for a reply full of brackets - which
is how a template leaves a blank - 1600 characters can still be 3200 septets and
still be refused. Naming the ceiling that currently applies is no better,
because it moves as she edits: delete two characters out of the middle of a
reply held at 899 by a trailing emoji and the ceiling drops to 700. So the
refusal says how much to cut - "Cut about 140 characters." - which is what the
guard actually knows, and says "about" because it is exact only for a delete
from the end.

**A shortened limit says it is shortened, and only when it is.** When the reply
would have fitted had nothing in it forced the shorter alphabet, the refusal
names that and offers the cheaper lever instead: "An emoji or special character
in it shortens what one text holds - take that out, or cut about 200
characters." A reply already too long without the special character does not get
that sentence, because there the special character is not the reason and
pointing at it would send her hunting for an invisible glyph that changes
nothing. See
[the decision log](../decisions/2026-08-18-name-the-thing-that-shortened-the-reply.md).

## Non-Goals

- **A segment counter.** The 2026-08-17
  [decision](../decisions/2026-08-17-refuse-long-replies-without-teaching-sms-segments.md)
  stands: nothing on screen tells the advisor how many separate texts a reply
  arrives as. `smsSegments` exists in the module because the caps are segment
  arithmetic and that arithmetic has to be tested somewhere, but no surface
  reads it.
- **Smart encoding.** Twilio can substitute GSM-compatible punctuation for
  Unicode lookalikes on a Messaging Service. Silently rewriting an advisor's
  words is a bigger product decision than this fix, and rewriting them would
  reintroduce the same class of defect from the other side.
- **Changing what the route does after the guard.** Delivery and webhook
  handling are untouched.

## Acceptance Criteria

- Given a 900-character reply with one emoji in it, when the advisor has typed
  it, then Send is disabled and the notice offers both levers - take the emoji
  out, or cut about 200 characters - before Send is pressed.
- Given the same reply with the emoji deleted, when the keystroke lands, then
  the notice clears and Send re-enables in the same render.
- Given a 1740-character reply with no character outside GSM-7, when she has
  typed it, then the notice says to cut about 140 characters and says nothing
  about emoji or special characters.
- Given a 1700-character reply with one emoji on the end, when she has typed it,
  then the notice says to cut about 102 characters and still says nothing about
  emoji or special characters, because the reply was too long without it.
- Given a reply of 900 brackets, when she has typed it, then the notice says to
  cut about 100 characters, rather than treating 900 characters as under 1600.
- Given a reply carrying an accented character GSM-7 does have (`é`, `à`, `ñ`),
  when she has typed 1500 of them, then nothing is refused.
- Given an over-long reply that reaches the route anyway, when the route
  measures it, then it refuses in the same sentence the box used, and a
  genuinely malformed request still reads as `Invalid message payload.`

## Risks / Open Questions

- **The alphabet is a transcribed table.** A wrong entry means refusing a reply
  Twilio would have taken, or taking one it will refuse. It is transcribed from
  Twilio's own published table and cross-checked against GSM 03.38, cited in the
  module, and covered by tests naming characters in both directions.
- **`smsSegments` is not read by any surface.** Accepted: the caps below it are
  segment arithmetic, and this is where that arithmetic is kept honest.
- **Below 700 the emoji surprise is still invisible.** A pasted curly quote
  still more than doubles what a short reply costs the dealership and nothing
  says so. Unchanged, and still the general manager's concern rather than the
  advisor's.
- Should the refusal point at the character responsible rather than describing
  it? It is known - the guard finds it. Not done: a curly quote and a
  non-breaking space both render as something the advisor cannot see, so naming
  the glyph would be worse than describing the class.

## Portfolio Notes

The interesting part is that the original limit was not a guess - it was a real
number, from the vendor's own documentation, correct in the case everyone tests.
It was wrong because it was a constant where the vendor has a function. A guard
that reads its input is the fix; a bigger constant would not have been.

The second part is scope discipline in the other direction. The full GSM
alphabet came back into the codebase, which a decision the day before had
deliberately kept out - but it came back to make a refusal correct, not to put
a number on screen the advisor cannot act on. The earlier decision is intact.

No live usage metrics; the product has no real dealership traffic. The signal to
watch after launch is the same one that PRD named: over-length refusals hit at
the route rather than in the box should stay near zero.
