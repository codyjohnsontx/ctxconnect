# PRD: The Customer Who Texted Gets a Name

## Status

Built

## Date

2026-08-31

## Summary

A customer who texts the dealership for the first time is created by the inbound
webhook as `Unknown 9911` - the last four digits of their phone number - and
nothing in Attend could ever change it. The advisor is told the real name in the
first sentence of the conversation and had nowhere to put it. The thread's
customer card is now editable: name, email and notes.

## Problem

`prisma.customer.create` appears nowhere in the product. There are two upserts,
one in the Twilio inbound webhook and one in the seed, and no update path at
all. Every field on `Customer` was read-only for the entire product's life.

Reproduced in the running app as the service advisor. The thread's "Customer
profile" card showed phone, email, preferred contact, SMS consent and notes as
five lines of static text, with no control anywhere. `notes` in particular is a
column the schema carries, the card renders, and nothing can write.

The name is the expensive one, because it is customer-facing. Ten seeded
templates open with `Hi {{customerName}}`, and the template blank check confirms
the name lands inside the first thirty characters of every one of them. So
Attend's one-click reply to a customer it has not met greets a real person by
the last four digits of their own phone number. The same string is on the queue
row, the alert rail, the Customers page and every follow-up card.

The card also rendered the preferred contact method through `labelize`, which
turns `SMS` into "Sms".

## Target User

The service advisor, in the thread. She is the one who learns the name, and the
thread is where she learns it - so it is where she should be able to write it
down, not on a separate admin screen she would have to go looking for.

## Goal

A customer can be named, emailed and annotated from the conversation, before
Attend texts them by a number.

## v1 Scope

**The card becomes a form, in place.** `CustomerProfile` reads the customer's
details and offers **Edit details**. Name, email and notes are editable; phone,
preferred contact and SMS consent stay read-only, because those are facts about
the customer's own device and their own consent rather than fields a member of
staff should retype.

**It opens straight into edit mode while the customer is un-named**, and shows
a line saying why. There is no cancel in that state: a cancel that leaves
"Unknown 9911" on the thread reads as a way to keep it.

**The name box starts empty rather than pre-filled with the guess.**
"Unknown 9911" is not an answer worth keeping, and pre-filling it would make her
select and delete it before typing what she was just told.

**One rule, checked twice, stated once.** `src/lib/customer-identity.ts` holds
the checks, the limits and the exact sentences. The card runs them so a refusal
lands in the box she typed in; the server action runs them again because a
client check is a convenience, not a guard. The action *returns* the refusal
rather than throwing it - a rejected name has to be fixable in place. Access
denial still throws: retyping cannot fix that.

**The placeholder is defined once.** `placeholderCustomerName` is used by the
inbound webhook to write the name and by `isUnnamedCustomer` to recognise it, so
the two cannot drift. Recognition is tied to the phone number: a person really
recorded as "Unknown 1234" on some other line has a name as far as this thread
is concerned, and prompting to replace it would be Attend second-guessing a
human.

**Client state, not an uncontrolled form.** React restores a form's mounted
values when its action resolves, so a saved name snaps back to the old one and a
second press writes the stale value over the real one. The card holds the draft
in state, re-seeds from the server during render, and offers Save only while the
draft differs from what is stored.

**Preferred contact is named the way an advisor would say it.** "Text message",
not "Sms".

## Non-Goals

- **Rewriting the wording of alerts already raised.** An alert stores its
  sentence at the moment it is written, so one raised before a rename goes on
  saying "Unknown 9911" until it resolves. Rewriting those bodies means editing
  the record of what an alert said at the time - through a string heuristic, in
  a loop, outside a transaction, with no audit entry for the edits. The alert
  rail already joins the live customer row, so only the Command Center renders
  the stored body, and deriving the name where it is read is smaller, reversible
  and touches no history. Deliberately out of scope here; filed for that
  surface.
- **Editing a customer from the Customers page.** The thread is the only
  editing surface in v1, because the thread is where the name is learned.
- **Creating a customer.** Still impossible; a customer who has only ever phoned
  the dealership has no row. Named because it is the obvious next gap, not
  because this closes it.
- **Phone, consent, vehicles.** Phone identifies the row and consent is the
  customer's own decision, recorded by STOP/START. Vehicles remain unwritable -
  the same shape of gap as this one, on a different model.

## Acceptance Criteria

- Given a customer named `Unknown 9911`, when the advisor opens the thread, then
  the profile card is already in edit mode with an empty name box and a line
  explaining why.
- Given she types a name and saves, then the queue row, the thread header, the
  Customers page and her follow-up cards all read the new name.
- Given she clears the name and saves, then the save is refused in place with a
  sentence naming what the name is used for, and the stored name is unchanged.
- Given an email that is not an email, then the save is refused in place and
  nothing is written.
- Given she saves and the card returns to its read-only state, then it shows
  the values she just saved rather than the ones the page loaded with.
- Given a customer whose threads she cannot read, when the action is called for
  them, then it is refused.

## Risks / Open Questions

- **Alerts raised before a rename keep the old name.** Named above. It is
  visible on the Command Center until those alerts resolve.
- **No name history.** The audit row records `from` and `to`; nothing surfaces
  it. Renaming is not a destructive act here, but it is one an advisor could
  get wrong.
- **The email check is deliberately loose.** It catches the mistakes a person
  makes typing between customers - a missing `@`, a stray space, half an
  address - and will accept an address that does not exist. Anything stricter
  rejects real addresses, and nothing in Attend sends email yet.
- No live usage metrics. The signal to watch is whether any customer is still
  called `Unknown ####` a day after their first text.

## Portfolio Notes

The gap was found by asking what a template actually sends. `Hi {{customerName}}`
is fine in a demo where every customer is seeded with a name, and it is a real
person's phone number in production the first time somebody new texts in. The
feature is a form; the reasoning that made it worth building first is that this
particular missing form was customer-facing.

The half deliberately left out is the more interesting decision. The obvious
follow-through from "the name is stale everywhere" is to go and rewrite the
places holding it, including the alerts. That means a string heuristic editing
the stored record of what an alert said when it was raised. The cheaper and more
honest answer is to derive the name where it is displayed, and it belongs to the
surface that displays it - so this change stops at the write it owns.
