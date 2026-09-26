# PRD: A Text Goes Out Only on Recorded Consent

## Status

In Progress - PR 1 of 5 (the consent ledger) built.

## Date

2026-09-24

## Owner

Cody Johnson

## Summary

Attend sends texts to dealership customers. Until now the only thing standing
between an advisor and a customer's phone was a boolean that defaulted to
"consented" and said nothing about why. This replaces it with a record: every
grant and every revocation is an event with a date, a method and evidence, and a
text leaves only when that record, the clock and the customer's local time say
it may, decided by plain code with no model involved.

## Problem

A customer created by any path other than texting in (the DMS import is the
first integration named in `docs/demo-script.md`) would be textable at birth
with no evidence of consent. Nothing enforced quiet hours. The STOP word list
missed three of the seven words the FCC treats as a revocation per se (REVOKE,
OPT OUT, OPTOUT), and "Stop." with a full stop fell through. A single wrong
text is a TCPA exposure of $500 to $1,500 and a customer who stops trusting the
store's number.

## Target User

The service advisor, who presses Send and must be able to trust that anything
Attend lets her send is allowed. The dealership owner, who carries the legal
risk and needs a record that holds up in a dispute.

## Goal

The owner's rule, settled 2026-09-24:

> Consent is a hard rule, not a judgment call: no recorded consent, outside
> quiet hours, or after a STOP reply means the send is blocked by plain code
> with no model involved.

## Background

The full analysis, sources and the five-PR plan are in the consent plan report
(section 11 is the PR breakdown). The owner answered its twelve decisions one
at a time on 2026-09-25 and 2026-09-26; they are binding and recorded below.

### Owner decisions

- **1** Quiet hours: the federal window only, 8am to 9pm in the recipient's
  local time, no Sunday rule.
- **1b** Replies outside the window: a reply to a customer text received in the
  last 24 hours may go at any hour; only business-initiated texts are held to
  8am to 9pm.
- **2** Recipient's local time: `Customer.timeZone`, null meaning the
  dealership's zone, editable on the customer card.
- **3** Stop wording that is not an exact keyword: exact keywords revoke; a
  fixed phrase list raises a HIGH review alert and blocks the thread until a
  person records the answer; the alert escalates rather than fades.
- **4** An ordinary text after STOP: stays revoked. Only START, UNSTOP (and YES
  per 8) or a staff-recorded grant restores it.
- **5** Scope: one implicit scope, conversational and informational about the
  customer's own business. "Attend sends no marketing" is a non-goal below; a
  `PROMOTIONAL` scope is reserved for a future design with its own
  written-consent method.
- **6** Expiry for business-initiated texts: a business-initiated text needs a
  grant or an inbound customer text within the last 18 months (the federal
  established-business-relationship period). Replies to a recent customer text
  are unaffected.
- **7** Evidence retention: `ConsentEvent` is never deleted, customer deletion
  is restricted, and the phone is copied onto each event.
- **8** Twilio console: enable Advanced Opt-Out, customise STOP and HELP
  replies to name the dealership and its service phone, keep YES as an opt-in
  keyword but record it as a grant only from a revoked state. The owner does
  the console steps, walked through, before PR 3 ships.
- **9** Cached status: `Customer.smsConsent`, written in the event's
  transaction, with a database-backed test that the cache equals the ledger.
- **10** A blocked attempt is audited with reason, user, conversation, customer
  and the body's length, not the body; the draft survives in the composer.
- **11** Legal questions (whether a human-pressed send is an autodialer, Texas
  telephone-solicitation registration or exemption, whether Texas calling hours
  reach texts to mobiles) go to the dealership's lawyer before Attend is used
  with real customers. The window must stay a one-line setting.
- **12** Staff-recorded consent: `VERBAL_AT_COUNTER` and `WRITTEN_FORM` are
  allowed, with evidence and the recorder required.

Decisions 1 and 6 differ from the plan's recommendations.

## v1 Scope

Five PRs, in order:

1. **The consent ledger** (built). `ConsentEvent`, its enums, the cached status
   on `Customer`, the backfill, `src/lib/consent.ts`, the widened keyword rule,
   the seed, and every badge reading one description.
2. **The single choke point.** One pure gate in front of the only Twilio send
   call, a permit type only the gate can make, no Message row on a refusal, an
   `AuditLog` row instead, `Message.consentEventId`, Twilio 21610 recorded as a
   revocation, and the 18-month rule for business-initiated texts (decision 6).
3. **Keywords, review alerts and staff-recorded events.** The review alert for
   stop requests in other words, HELP stored with no reply, and the profile
   card actions to record a stop request, a verbal or written consent, or a
   correction.
4. **Quiet hours.** 8am to 9pm in the customer's zone (decision 1), with the
   24-hour reply exemption (decision 1b), and `Customer.timeZone` on the card.
5. **Audit surfaces, runbook and demo.** Consent history on the card, a
   blocked-sends count, runbook scenarios and a demo beat.

## Non-Goals

- **Attend sends no marketing.** Every text Attend can send is conversational
  or informational about the customer's own business with the store.
- Scheduling or queueing a blocked text to go later. A refusal says when the
  window opens; the draft stays in the composer.
- Voice and email consent. The ledger has a `channel` column so they cannot
  borrow SMS consent later, and only `SMS` exists.
- Reading Twilio's block list. Twilio offers no API for it; Attend's record is
  the truth and Twilio's list is the backstop.

## User Flow

1. A customer texts the store. Attend records that they texted first, with the
   text as evidence, and the advisor can answer.
2. The customer texts STOP (or OPT OUT, REVOKE, "Stop."). Attend records the
   revocation with the text. Attend sends nothing back; Twilio's own reply is
   the one confirmation allowed. The composer is blocked and says START from
   their phone resumes texting.
3. The customer texts START. Texting is allowed again, since that moment.
4. A customer imported with no text and no recorded consent reads "No consent
   on record" everywhere and cannot be texted until a record exists.

## Requirements

- No customer is consented by default.
- The ledger is append-only; a correction is a new event.
- Every surface that shows consent reads one description from
  `src/lib/consent.ts`.
- Nothing about consent depends on a model's output.

## User Stories

- As a service advisor, I want the composer to refuse a text the store has no
  right to send, so that I never have to remember who opted out.
- As a service advisor, I want to see since when and why a customer may be
  texted, so that I can answer a customer who asks why they are hearing from us.
- As the owner, I want every grant and revocation recorded with its evidence,
  so that a dispute can be answered from the record.

## Acceptance Criteria

PR 1:

- Given the seeded database, when the migration runs, then every seeded
  customer who texted in is `GRANTED` with `smsConsentEventId` naming an event
  whose `messageId` is their first inbound message, Lena Ortiz is `REVOKED`
  naming the STOP message, and no seeded customer is `NONE`.
- Given a customer row inserted with no event, then its status is `NONE`, the
  customers page shows "No consent on record" in red, and a send returns 403
  with `NO_CONSENT`.
- Given `tests/consent.test.ts`, then the derivation is pinned: empty is NONE;
  latest `occurredAt` wins over `createdAt`; STOP then START is GRANTED; every
  `ConsentMethod` is classified as GRANTED-only, REVOKED-only or either, and
  the migration's CHECK constraints agree.
- Given `tests/consent-keywords.test.ts`, then "STOP", "stop", " Stop. ", "OPT
  OUT", "optout", "REVOKE" revoke; "unstop" and "start" grant; "stop please" is
  a review phrase, not a revocation; "yesterday" is nothing.
- Given the database-backed `tests/consent-cache.test.ts`, then for every
  customer the cached status equals `consentState` over their events.
- Given `docs/twilio-local-verification.md` scenario 3 replayed, then STOP and
  START each write exactly one `ConsentEvent` and a replay writes nothing.

PRs 2 to 5 carry the acceptance checks in the plan's section 11, amended by
owner decisions 1, 1b and 6 above.

## Edge Cases

- A customer's first-ever text is STOP: recorded as a revocation only, never as
  texting first.
- YES from a customer who has not opted out is an ordinary "yes", not a
  consent event.
- An ordinary text after STOP restores nothing (decision 4).
- A possible stop request in other words ("stop texting me") writes no event in
  PR 1 and, in particular, does not count as texting first. PR 3 raises the
  review alert.
- A staff-recorded event dated before a later STOP does not outrank the STOP:
  the ledger orders by when the customer acted.
- A STOP and a START landing together are recorded one after the other; the
  cache is recomputed under a lock on the customer row.
- An ordinary text racing a STOP from the same customer: the webhook takes the
  customer's lock before it writes anything, reads the consent status under it,
  and dates the text from the database clock under it, so whichever text takes
  the lock first is both classified first and sorted first. The customer ends
  opted out in every interleaving (decision 4).
- Two legacy texts in the same millisecond: the backfill orders them by when
  the old webhook recorded the opt-in or opt-out each one caused; if those
  records tie too, by the customer's final legacy flags, so the keyword
  matching where they ended up comes last; then by id. Never by a random
  event id.

## Data Requirements

- `ConsentEvent`: customer, phone copied at write time, channel, kind, method,
  the evidencing message, the recorder, evidence text, when the customer acted,
  when the row was written, provider reference.
- `Customer.smsConsent` and `Customer.smsConsentEventId`, replacing
  `smsOptedIn`, `smsOptedOut`, `optedInAt`, `optedOutAt`. `OptInEvent` is
  dropped once backfilled.
- Before the migration runs against production, the owner runs the read-only
  count in the plan's section 4.6 and puts the numbers in the PR.

## Analytics / Success Metrics

No real usage metrics yet. Signals to track after launch: blocked sends by
reason (PR 5's Settings count), customers at `NONE` after the DMS import, and
review alerts older than one business day.

## Risks

- Existing behaviour tightens: a customer with no inbound text and no event
  becomes unsendable, and a customer who once texted "REVOKE", "OPT OUT" or
  "Stop." is now opted out. The pre-migration count shows the first set.
- Deploy skew: the old columns are dropped, so code still running from the
  previous deploy fails on customer reads until the new build takes over.
- A review alert nobody acts on (PR 3) is a violation at ten business days; the
  alert must escalate.
- Clock and zone bugs are invisible locally (PR 4).

## Open Questions

- The three legal questions in decision 11, for counsel.
- Reassigned numbers: decision 6's 18-month rule limits exposure but does not
  detect a number that changed hands.

## Tickets

The five PRs in v1 Scope, each with the acceptance checks above or in the
plan's section 11.

## Implementation Notes

PR 1:

- `src/lib/consent.ts` is database-free: `consentState`, `describeConsent`,
  `cachedConsentState`, `consentBlockMessage`, `classifyConsentReply`,
  `inboundConsentEffect`, and `consentMethodRules`, a `Record` over the method
  enum so a new method does not compile unclassified.
- `src/lib/consent-ledger.ts` `recordConsentEvent` is the only writer of an
  event and of the cache. It locks the customer row, inserts, and rewrites the
  cache from `consentState` over the whole ledger in the same transaction.
- The migration carries two CHECK constraints Prisma cannot express: the
  pairing of method to kind, and the recorder and evidence every staff-recorded
  method needs. The recorder's foreign key is `RESTRICT`, not `SET NULL`,
  because nulling it would break that check. A trigger refuses any update or
  delete of an event, except the `SET NULL` that clears `messageId` when the
  evidencing text is deleted, and a statement trigger refuses `TRUNCATE`,
  including one cascading from `Customer`. Dropping the schema, which is what
  a migrate reset does, is unaffected.
- The backfill classifies every stored inbound text with the widened rule,
  restated as the SQL function `consent_classify_reply`, rather than copying
  `OptInEvent` rows, so each event names the text it rests on. As in the
  webhook, a possible stop request in other words is not texting first: the
  grant rests on the first text that is not one, and a customer who only ever
  sent one stays `NONE`. `OptInEvent` rows the texts do not reproduce (seeded
  rows, or a webhook row whose text is gone) are kept, saying where they came
  from. Backfilled ids are numbered in that order, so a tie at the same
  `occurredAt` resolves the same way every time.
- Every text is read in one canonical form, identical in the webhook and the
  backfill's SQL: Unicode NFKC, invisible format characters (zero-width
  spaces and joiners, soft hyphens, direction marks) removed, every line
  break (including U+0085 and U+2028) a line break and every other space a
  space, upper-cased, and every quote, bracket, asterisk, dash, punctuation
  mark or emoji a separator; an apostrophe belongs to a word only between two
  letters or digits. So “STOP”, ‹CANCEL›, 「QUIT」, *STOP*, "STOP…",
  "STOP 🛑" and "S\u200BTOP" revoke, and ‹START› grants. Where the rule has
  to guess, it guesses stop request.
- The review phrase list leaves out CANCEL, END and QUIT as words inside a
  longer text: they revoke as a whole message, but "cancel my appointment" and
  "end of the day" are a service inbox's ordinary business. STOP stays in it,
  except in the everyday phrasings "stop by", "stop in", "stop at", "stop
  over", "won't stop", "wont stop" and "will not stop" ("can I stop at the
  shop at 3", "my brakes will not stop"). Such a phrase lets a text through
  only when nothing else in the whole message could be a stop request: no
  other review word or phrase, and no contact word anywhere (text, txt,
  message, msg, sms, call, contact, number and their forms), so "you won't
  stop. You texted me again." goes to review. Its words join only across
  spaces on one line, never punctuation or a line break ("Stop. In future
  call me"), and "stop at once" is always a stop request.
- The seed writes events the way the real writers do: the webhook's rule over
  each seeded text, and a staff-recorded consent (one verbal, one written) for
  the two seeded customers who never texted in. That happens once per
  customer: a reseed leaves any customer who already has a consent history
  exactly as it stands, because replaying the recreated texts would append a
  "texted first" newer than a STOP recorded since.
- The send route refuses anything but `GRANTED` with 403 and a `reason` of
  `REVOKED` or `NO_CONSENT`. The 18-month rule (decision 6) is PR 2's: the
  ledger already exposes when a grant was made, and the inbound-text half of
  the rule reads messages, not the ledger.

## Portfolio Notes

A compliance rule turned into product design: the owner's "hard rule, not a
judgement call" became a data model (an append-only ledger with evidence) and a
single pure function every surface reads, rather than a model or a checkbox.
The scope was cut into five reviewable PRs, and the twelve owner decisions were
taken one at a time, two of them against the recommendation. No live usage
metrics yet.
