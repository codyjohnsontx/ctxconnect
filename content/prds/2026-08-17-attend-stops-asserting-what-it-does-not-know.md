# PRD: Attend Stops Asserting What It Does Not Know

## Status

Built, with the length limit superseded on 2026-08-18, the queue row's
undelivered marker superseded on 2026-08-19, and the advisor's name superseded
on 2026-09-01.

**The advisor is not a detail Attend can always answer.** The thread page
defaulted `advisorName` to `"the team"` before `fillTemplate` ran, so a thread
nobody had picked up texted the customer that stand-in where a person's name
belongs, and Send stayed enabled because no blank was ever left. `advisorName`
is now `string | null` exactly as `unit` is: an unassigned thread reads
`[advisor name]` and Send is held, the same way a customer with no vehicle on
file reads `[unit]`. Nothing else moved - `fillTemplate`'s blank rule and the
composer's Send condition are byte-identical, only the declared type widened, and
an assigned thread still fills the advisor's own name.
`tests/templates.test.ts` pins both cases and the bare prop.

**The 1600-character limit named below is the GSM-7 limit only.** One emoji or a
pasted curly quote moves the reply to UCS-2, where Twilio takes 700, so the
guard now reads the body for its encoding rather than counting every reply
against one number, and the refusal names how much to cut rather than a ceiling.
See
[The Length Guard Reads the Reply](./2026-08-18-the-length-guard-reads-the-reply.md).
That change left the template blanks and the undelivered reply alone.

**The queue row marker described below is keyed to the wrong message.** The row
prefixed the preview with a red **Not delivered:**, which vanished as soon as
anything was written after the failed reply. It now marks the conversation -
whether the newest reply staff sent is still undelivered - on its own line above
the preview, and the preview keeps its author label. See
[The Queue Row Marks the Conversation, Not the Preview](./2026-08-19-the-queue-row-marks-the-conversation.md).
That change left the thread bubble, the composer banner, the template blanks and
the length guard alone.

## Date

2026-08-17

## Owner

Cody Johnson

## Summary

Three places where Attend stated something it had no basis for, all of them
reaching a customer or shaping what the advisor did next.

A canned reply filled a confirmed appointment date and pickup time with
hardcoded guesses, so the product could text a customer "your service
appointment is confirmed for tomorrow morning" when no appointment existed. A
reply that never left the building rendered in the same bubble as a delivered
one, so the advisor read her own unsent text as an answer already given. And a
reply too long to send was accepted by the box and refused only after Send, in
words that read as broken software rather than as a message about length.

All three now say what is actually known: a template leaves a blank and refuses
to send until it is filled, an undelivered reply looks undelivered everywhere it
appears, and an over-long reply is refused before Send with the number of
characters to cut.

## Problem

Each of the three was reproduced against `main` before it was fixed.

### 1. The product texts a customer an appointment time it does not have

`src/components/message-composer.tsx` substituted template placeholders with
string literals:

```ts
.replaceAll("{{appointmentDate}}", "tomorrow morning")
.replaceAll("{{pickupTime}}", "6:00 PM")
```

Neither value exists anywhere in the data model. There is no appointment entity,
no scheduled time, and no service-hours field - the product structurally cannot
know either fact.

Reproduced on the seeded first-service thread, where the customer had asked
*"My Ninja is coming up on its 600 mile service. What days do you have open next
week?"*. Selecting **Appointment confirmation** produced:

> Hi Kelsey Nakamura, your service appointment is confirmed for tomorrow morning
> with Alyssa Torres.

Send was enabled. Pressing it stored that exact body on the message row and
handed it to the send route, which passes the body straight to
`client.messages.create({ body })`. With texting connected, that sentence
reaches the customer's phone as a confirmed fact. `{{unit}}` had the same shape
of defect in a smaller way: a customer with no vehicle on file was texted about
"your unit".

Verified during the fix that `/api/messages/send` is the only outbound path and
that no server-side code expands a template, so the composer is the only place a
placeholder becomes text. The Templates page renders the raw body and substitutes
nothing.

### 2. A failed text looks sent

The delivery state was already correct - `deliveryStatus: FAILED` and an
`errorMessage` were written on every failure path. Nothing showed it.

- The queue row previewed the undelivered body with no marker, so the advisor's
  own unsent text read as the latest thing said in the thread.
- The thread rendered it in the same `bg-zinc-950` bubble as a delivered reply.
  The only signal was an 11px, 60%-opacity footer carrying the cause in vendor
  English: *"Failed · Twilio configuration is incomplete. Review Settings >
  Integration health."*
- A failed send did not refresh the thread, so the attempt did not appear at all
  until the advisor navigated away and back - after which it looked sent.

The cost is not cosmetic. An advisor who believes the customer was contacted
follows up as though the ball is in the customer's court, and the customer is
waiting on a reply that was never sent.

### 3. The reply box does not say a long message will be refused

The send route capped the body inside the Zod schema (`.max(1600)`), so an
over-long reply failed schema parsing and came back as `Invalid message
payload.` - the same response a malformed request gets. Reproduced by typing
1740 characters: no warning appeared, Send stayed enabled, and pressing it
returned a sentence that names no cause and suggests no action. It is
indistinguishable from a bug.

## Target User

The service advisor. All three defects either put words in her mouth that she
did not choose, or hid from her what the product had actually done.

## Goal

Attend never states a fact it cannot support. Where it does not know something,
it asks; where something failed, it says so; where it will refuse, it refuses
before the advisor commits.

## v1 Scope

**Templates leave a blank.** `src/lib/templates.ts` splits placeholders into the
details Attend can read from the thread (customer, advisor, dealership, unit)
and the details only the advisor knows. A known detail is filled. An unknown one
becomes a visible blank - `{{appointmentDate}}` becomes `[appointment date]` -
the first blank is pre-selected so filling it in is the next keystroke, and the
composer refuses to send while a blank remains. `unit` is now `string | null`;
with no vehicle linked it becomes `[unit]` rather than the word "unit".
Superseded 2026-09-01: the advisor belongs on that same footing and did not get
it here - `advisorName` is `string | null` too, per the Status note.

**Undelivered looks undelivered.** `src/lib/message-delivery.ts` holds the one
rule the row, the bubble, and the composer must agree on. The row prefixes the
preview with a red **Not delivered:**. The bubble keeps its side and shape but
loses the delivered colour, and carries "Not delivered - the customer never got
this." with the recorded cause beneath it. The composer offers the unsent text
back while the box is still empty, and a failed send refreshes the thread so the
attempt is visible immediately. The Twilio-not-configured failure was reworded
to name who can fix it rather than the vendor behind it.

**Superseded 2026-08-19.** The row does not prefix the preview; it marks the
conversation on its own line above it. See
[The Queue Row Marks the Conversation, Not the Preview](./2026-08-19-the-queue-row-marks-the-conversation.md).
The rest of this paragraph stands.

**Over-length is refused before Send.** `src/lib/sms-length.ts` holds the limit
and the sentence, shared by the box and the route so both refuse in the same
words. The box shows how many characters to cut and disables Send; the route
keeps its own check as defence in depth, and a genuinely malformed request still
reads as malformed.

Also fixed, found while driving the thread: a message containing one long
unbroken word - an ordinary photo link - overflowed its bubble at every width
(337px of text in a 291px box), so the middle of the URL could not be read.
`break-words` on the bubble and the row preview.

## Non-Goals

- **A segment counter.** See
  [the decision log](../decisions/2026-08-17-refuse-long-replies-without-teaching-sms-segments.md).
  Attend does not tell the advisor how many separate texts a reply arrives as.
- **Storing appointments.** A blank the advisor fills in is the fix. Giving
  Attend real appointment data is a much larger change and is not needed to stop
  it lying.
- **Retrying a failed send automatically.** The advisor decides whether to
  resend; Attend's job here is to stop hiding the failure.
- **Editing templates in the product.** Template bodies stay seeded.

## User Flow

1. The customer asks what service days are open. The advisor opens the thread and
   picks **Appointment confirmation**.
2. The box reads "...confirmed for **[appointment date]** with Alyssa Torres."
   with `[appointment date]` already selected, and below it: *"Fill in
   [appointment date] before sending. Attend does not know that, so it never
   guesses."* Send is disabled.
3. She types "Tuesday at 2pm". The notice clears and Send enables.
4. She presses Send and texting is not connected. The composer says so in words
   she can act on, and the reply appears in the thread immediately in a red
   bubble reading "Not delivered - the customer never got this."
5. She returns to the queue. The row reads **Reply not delivered** above the
   preview, so she knows the customer is still waiting - and it keeps saying so
   after she adds an internal note that takes over the preview line. As first
   built this step read "the row reads **Not delivered:** before her text", which
   only held while the failure was the last word in the thread; superseded
   2026-08-19.
6. Later she writes a long reply. Past 1600 characters the box tells her how many
   to cut and disables Send, before she presses it.

## Requirements

- A template placeholder Attend cannot answer must never be substituted with a
  literal, and must block Send until the advisor fills it in.
- A blank must be recognisable as Attend's, so the advisor's own brackets
  (`[see photo]`) never block Send.
- An outbound message with `deliveryStatus: FAILED` must be visually distinct
  from a delivered one in the thread, and marked on the queue row.
- The composer must offer an unsent reply back only while the box is empty, and
  only when no later reply reached the customer.
- The over-length refusal must be distinguishable from the malformed-payload
  refusal, and must name how much to cut.
- The box and the route must measure length identically, trimmed, so neither
  refuses what the other accepts.

## Acceptance Criteria

- Given a template naming an appointment date, when the advisor applies it, then
  the draft contains `[appointment date]` and no invented date, and Send is
  disabled with a notice naming the blank.
- Given a draft still containing a blank, when she presses Send, then nothing is
  sent.
- Given she types over the blank, when the last blank is gone, then Send enables.
- Given a customer with no vehicle on file, when a template names the unit, then
  the draft reads `[unit]`.
- Given a thread nobody has picked up, when a template names the advisor, then
  the draft reads `[advisor name]` and Send is held. Added 2026-09-01: as shipped
  here this case filled "the team" and left Send enabled, per the Status note.
- Given an outbound message that failed, when the advisor views the thread, then
  the bubble is visually distinct from a delivered reply and states the customer
  never got it.
- Given a conversation whose newest reply is undelivered, when she views the
  queue, then the row is marked **Reply not delivered** above the preview -
  whatever message is currently previewing, including a later internal note. As
  first written this criterion only covered a failed reply that was the newest
  message, which is the case that never broke; superseded 2026-08-19.
- Given a failed reply and an empty box, when she opens the thread, then she is
  offered the unsent text back.
- Given a later reply that did reach the customer, when she opens the thread,
  then the older failure is not offered back.
- Given a reply over 1600 characters, when she has typed it, then Send is
  disabled and the notice names how many characters to cut - before Send is
  pressed.
- Given a malformed request, when it reaches the route, then it still reads as
  `Invalid message payload.` rather than as a length problem.

## Edge Cases

- A known value present but blank (`dealershipName: "   "`) is treated as unknown
  rather than silently dropped, so the template asks instead of producing a gap.
- A placeholder nobody has taught Attend (`{{loanerVehicle}}`) becomes a blank
  rather than surviving as raw `{{...}}` in a customer text.
- A repeated placeholder is listed as one blank, not two.
- A failed inbound message is a record on the customer's side and must not wear
  the advisor's warning; only OUTBOUND + FAILED does.
- A later inbound message or internal note does not clear the failure - the
  customer is still waiting.
- Trailing whitespace must not push a reply over the limit, because the route
  trims before it measures.
- Re-picking the same template after fumbling a blank works, because the select
  returns to its prompt after each pick.

## Data Requirements

No schema change. `Message.deliveryStatus` and `Message.errorMessage` already
carried everything the presentation needed. The only stored-value change is the
wording written to `errorMessage` when texting is not connected.

## Analytics / Success Metrics

No live usage metrics - the product has no real dealership traffic.

Expected outcome: Attend can no longer text a customer an appointment time
nobody booked, and an advisor can no longer mistake an unsent reply for a sent
one.

Metrics to track after launch:

- Templates applied that were sent with a blank filled in, versus abandoned.
- Failed replies followed by a resend, and how long that takes.
- Over-length refusals hit in the box versus at the route (the route figure
  should stay near zero; anything else means the box is not warning in time).

Portfolio-safe claim: three customer-facing correctness defects were reproduced
end to end, fixed, and covered by tests. No usage claims.

## Risks

- **A blank could be texted.** The composer refuses while a blank remains, but
  the refusal matches on the exact blank strings Attend inserted. An advisor who
  reformats a blank by hand into something similar-but-different could get past
  it. Accepted: a blank reaching a customer reads as an obvious unfinished draft,
  which is recoverable, whereas an invented time reads as fact.
- **The red bubble is a colour signal.** It also carries text and an icon, so it
  does not depend on colour alone.
- **The 1600 limit is Twilio's, so it is not ours to raise.** Twilio rejects a
  longer body outright. It matches what the route has always enforced; this
  change only makes the refusal legible.

## Open Questions

- Should a blank left unfilled for a long time prompt anything, or is a disabled
  Send enough? Enough for now.
- Should the advisor be able to resend a failed reply in one press, rather than
  being handed the text back to send again? Deferred - a one-press resend needs a
  view on whether the original failure is likely to repeat.

## Implementation Notes

Three new pure modules, each shared by more than one surface so the rule has one
home: `src/lib/templates.ts`, `src/lib/message-delivery.ts`,
`src/lib/sms-length.ts`. `src/components/ui/field.tsx` now types `Textarea` as
`ComponentPropsWithRef<"textarea">` so the composer can put the cursor on a
blank.

This work was rebuilt deliberately from three commits on the unlanded
`gnhf/pretend-you-are-a-us-a30bb1` branch (`504a97c`, `0846130`, `aa4b05e`),
which were read as reference rather than merged. The segment counter that came
with `aa4b05e` was left out.

## Portfolio Notes

The product decision worth talking about is what to do when software does not
know something. The tempting fix for a missing appointment date is to build
appointments; the cheap fix is to keep guessing and hope. Leaving a blank the
human fills in is neither, and it is the right call: it costs one component
change, it is honest, and it makes the gap visible to the person who can close
it.

The second decision is a scope cut in the opposite direction - declining to show
the advisor a number she cannot act on, even though the arithmetic was already
written. Recorded in
[the decision log](../decisions/2026-08-17-refuse-long-replies-without-teaching-sms-segments.md).
