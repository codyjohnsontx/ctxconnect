# Decision: Consent Is a Ledger, Not a Flag

## Date

2026-09-24

## Status

Accepted

## Context

Attend recorded SMS consent as two booleans on `Customer`: `smsOptedIn`,
defaulting to true, and `smsOptedOut`. Any row created by any path was
consented at birth with no evidence, and nothing said why a customer could be
texted or since when. The owner settled the rule on 2026-09-24: consent is a
hard rule, not a judgement call, enforced by plain code with no model involved.
A rule like that needs something to read, and a boolean with a permissive
default is not a record of anything.

## Options Considered

1. Keep the booleans, flip the default to false, and add a "consent source"
   column.
2. An append-only `ConsentEvent` ledger, with the status derived from it and
   cached on `Customer` in the same transaction.
3. The ledger with no cache, computing the status on every read.

## Decision

Option 2. Every grant and revocation is an event with the phone number, the
method, when the customer acted, and the evidence (the inbound text, or for a
staff-recorded method, the recorder and what the customer said or signed). The
status is `consentState` over those events, in `src/lib/consent.ts`, and
`Customer.smsConsent` caches it, written only by `recordConsentEvent` in the
event's transaction. A customer with no event is `NONE`, and `NONE` is not
textable.

## Reasoning

- Option 1 records one fact at a time and overwrites it. A dispute asks what
  the customer did and when, including what they did before the last change,
  and an overwritten column cannot answer that.
- The ledger matches how the repo already treats shared rules: one
  database-free module and its tests, read by every surface.
- The cache (owner decision 9) keeps the customers list and the queue to one
  query, and a database-backed test holds it equal to the ledger.
- Events are never updated or deleted and customer deletion is restricted
  (owner decision 7), so a STOP outlives any edit to the customer.

## Tradeoffs

- More rows and one more table than a flag, and a customer the ledger holds
  evidence about can no longer be deleted.
- Behaviour tightens on migration: a customer who once texted "REVOKE", "OPT
  OUT" or "Stop." is now opted out, and any customer with no text and no event
  becomes unsendable. That is the intent, and the pre-migration count in the
  PRD is how the owner sees it before it happens.
- The demo reseed can no longer wipe consent history; each reseed appends.

## Portfolio Notes

Turning a legal requirement into a data model: the question "may we text this
person?" became a pure function over an evidence ledger, so the answer can be
tested exhaustively and explained on screen ("Opted out since 3 Sep - they
replied STOP") instead of trusted.

PRD: [2026-09-24 A Text Goes Out Only on Recorded Consent](../prds/2026-09-24-a-text-goes-out-only-on-recorded-consent.md).
