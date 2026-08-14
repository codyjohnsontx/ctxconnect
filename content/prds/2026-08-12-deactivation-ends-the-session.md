# PRD: Deactivation Ends the Session

## Status

Built

## Date

2026-08-12, extended 2026-08-14

## Summary

Turning a staff account off in Settings did nothing to the person's current
session. Their sign-in token stays valid for 30 days and nothing re-checked the
account behind it, so a deactivated advisor kept full read and write access to
the dealership inbox until the token expired on its own. Every authenticated
request now resolves the account from the database, so deactivation takes effect
on the next request.

Deactivation is also final and visible. A page load and a form submit both land
on the same one-sentence notice. The session itself is ended on the account
rather than on one device, so reactivating does not wake up a browser the person
still has open - coming back means signing in again. And the admin who pressed
Deactivate can see what it did: the members list shows when access ended and
when that account was last granted a request.

## Problem

An admin who deactivates a staff member believes access is gone. It is not.

`Settings → Staff → Deactivate` writes `active = false` and nothing else. Access
is decided by a NextAuth JWT that carries the account id, role and department,
and it was only checked once, in `authorize()`, at the sign-in that minted it.
Until that token expires the app trusts it, so a deactivated staff member can:

- open the inbox and read every customer thread, name, phone number and message
  their department scope allows,
- create follow-ups, add internal notes, reassign conversations, change status
  and priority,
- accept, dismiss and act on AI briefs.

The same gap has a second, louder face. If the account row is gone rather than
just inactive, reads still succeed but the first write fails on a foreign key
and the person gets a full-page `A server error occurred. Reload to try again.
ERROR 573717337`. Reloading never helps, because the session is the problem.

Reproduced 2026-08-12 against local seeded data. With `service@ctxchat.local`
set to `active = false`, `GET /inbox` returned 200 with Renee Whitlock's thread
and phone number in the body, and `POST /api/ai/ops-brief/<id>/action` returned
`{"ok":true}`. With a session pointing at a deleted account, submitting the
Create follow-up form crashed the page with the error above.

## Target User

The dealership admin or GM who removes access when someone leaves the store or
changes roles, and the advisor whose account is switched off mid-shift.

## Goal

Deactivation means what it says: the next request from that person fails rather
than succeeding for up to 30 days. A page load and a form submit both land on the
login screen with one plain sentence instead of a blank form or a crash; an API
call is refused outright.

## Background

Sessions are JWT-based (`session.strategy = "jwt"`) with the NextAuth default of
30 days. Five entry points authenticated independently - the page helper, the
server-action helper, and three route handlers - and each one trusted
`getServerSession` on its own. There is no session revocation list, and adding
one is not necessary: the account row already carries `active`.

## v1 Scope

Shipped 2026-08-12 (PR #19):

- One resolver, `src/lib/session.ts`, re-reads the account on every
  authenticated request and returns nobody when it is missing or inactive.
- All five entry points go through it. Pages redirect, server actions throw,
  route handlers return 401.
- Name, email, role and department come from the row rather than the token, so a
  future role change also takes effect on the next request.
- The login page resolves the same way, so a deactivated session is not bounced
  back to the inbox that just rejected it.
- The login page explains that the account is no longer active.

Added 2026-08-14, once the product owner confirmed that deactivation is usually
a firing:

- **One screen for both paths.** Server actions go through the page helper and
  redirect to the same notice a page load gets, rather than throwing onto Next's
  error screen. API routes still answer 401; they are read by code.
- **A notice that stops talking.** One sentence, neutral rather than amber, no
  call to action. Someone who was just let go knows why, and "ask an
  administrator" reads as either cruel or as false hope.
- **The session ends on the account, not on a device.** Deactivating stamps
  `User.accessEndedAt`, and any session minted before that instant is refused
  wherever it turns up - laptop, phone, or a tab left open at home - and stays
  refused after the account is switched back on.
- **Evidence for the admin.** A deactivated account's row in Settings shows when
  access ended and when that account was last granted a request.

## Non-Goals

- Clearing the stale session cookie. A server render cannot write cookies, and
  clearing one only reaches the device that happened to make the request. The
  cutoff on the account reaches all of them, and leaves the inert cookie alone.
- A shorter session lifetime, refresh tokens, or a full revocation store. One
  timestamp per account is the whole mechanism.
- An audit trail of deactivations. `AuditLog` already records who pressed the
  button; Settings shows the current state, not a history.
- Showing last-seen for active staff. The members list is an access record, not
  an activity monitor; the line appears only once an account is switched off.
- Telling someone at the sign-in form that their account is deactivated rather
  than that their password is wrong. Different surface, different tradeoff.
- Deleting staff accounts. Settings deactivates; nothing in the product deletes,
  and the deleted-account path is covered only because a session can outlive a
  row removed outside the app.
- Editing a staff member's role or department, which the product still cannot do.

## User Flow

1. An advisor is working her inbox with a valid session.
2. An admin opens Settings and deactivates her account.
3. Her next request - any page, any form, any AI action - resolves the account,
   finds it inactive, and refuses it. Nothing she submits is written.
4. On a page load she lands on the login page above one quiet sentence: this
   account is no longer active. Nothing else - no next step, no one to call.
5. A form submitted from a tab she already had open lands on the same sentence.
   The write is refused before it reaches the database.
6. Her phone, still signed in, is refused on its next request too.
7. Signing in again fails at the credentials check, which already refuses
   inactive accounts.
8. The admin, still on Settings, sees her row read Inactive with the time access
   ended and the time of her last granted request, which is earlier.
9. If the admin deactivated the wrong person and switches her back on, her old
   sessions stay dead. She signs in once and resumes.

## Requirements

- No module outside `src/lib/session.ts` may read the session directly.
- A missing account and an inactive account are treated identically.
- The deactivation notice appears only when the account really is switched off,
  never after an ordinary sign-out, an expired token, or a session refused for
  being older than a cutoff on an account that is currently active.
- The notice carries no call to action, no support contact and no button.
- Pages and server actions are refused identically. Route handlers keep
  returning 401, because their caller is code.
- A session that predates an account's cutoff is refused even when the account
  is active again.
- `lastSeenAt` moves only on a request that was granted, and the write itself
  carries `active: true`, so a deactivation committing between the account read
  and the write skips it rather than stamping a time later than the cutoff.
- An active user sees no behaviour change.

## User Stories

- As a dealership admin, I want deactivating an account to cut off access
  immediately, so that a departing employee cannot read customer conversations
  after they leave.
- As an advisor whose account was switched off mid-shift, I want to be told
  plainly that the account is off, so that I stop retyping a password that will
  never work.
- As a dealership admin, I want to see that deactivating worked and when the
  person was last active, so that I can say they are out and mean it.

## Acceptance Criteria

- Given an advisor with a live session, when an admin deactivates her account,
  then her next page load redirects to the login page.
- Given that redirect, when the login page renders, then it shows one sentence
  saying the account is no longer active, and no next step, contact or button.
- Given an account that was reactivated, when a session older than its cutoff
  is used, then the person is refused to a plain login page with no notice,
  because the account is active and the notice would be false.
- Given an account that is already inactive, when Deactivate is submitted
  again from a stale tab, then the recorded cutoff does not move.
- Given a deactivated account, when a form is submitted from a tab that was
  already open, then the write is refused and the tab lands on that same notice
  rather than on an error screen.
- Given a deactivated account signed in on a second device, when that device
  makes its next request, then it is refused as well.
- Given an account that is deactivated and then reactivated, when a session
  minted before the deactivation is used, then it is still refused, and signing
  in again works.
- Given a deactivated account, when any authenticated API route is called with
  its session, then the response is 401 and no data is returned.
- Given a deactivated account, when the login page is opened with its session
  cookie still present, then the login page renders rather than redirecting back
  to the inbox.
- Given a session whose account row no longer exists, when a follow-up is
  submitted, then the write is refused before it reaches the database rather
  than failing on a foreign key, and the tab lands on the notice.
- Given a deactivated account, when an admin opens Settings, then that person's
  row shows when access ended and when the account was last granted a request,
  and the second is never later than the first.
- Given a deactivation that commits while a request from that account is already
  in flight, when that request's bookkeeping write runs, then it matches no rows
  and is skipped, so the record cannot show a granted request after the cutoff.
- Given an active account, when any page, form or AI action is used, then
  behaviour is unchanged.

## Edge Cases

- **Redirect loop.** The login page previously redirected any session holder to
  the inbox. With the inbox now rejecting deactivated sessions, that pairing
  would have looped; the login page resolves the account the same way.
- **Reactivation.** The account works again, but its old sessions do not:
  reactivating now costs one sign-in. That is the deliberate price of the cutoff
  reaching every device, and the case it hurts - "we deactivated the wrong
  person" - is the one where a sign-in costs nothing.
- **Sessions predating the cutoff claim.** A session minted before this change
  carries no sign-in timestamp, so it holds no evidence of when it began and is
  refused - whether or not its account has a cutoff. **Everyone signed in at the
  moment this deploys therefore signs in once more, on purpose.** The alternative
  was backfilling a cutoff onto every already-inactive account, which closes the
  same hole but writes an "Access ended" time nobody can defend onto the one
  screen built to be trusted. Refusing what cannot be proven costs a single
  sign-in, once; guessing would cost the record its meaning permanently.
- **An account never deactivated.** No cutoff, so once its staff have signed in
  again after the deploy there is no behaviour change.
- **Deactivated before this change, then reactivated.** No cutoff was recorded,
  so nothing distinguishes that account's month-old cookies by timestamp - they
  are refused for carrying no sign-in claim at all, which is why that claim is
  checked before the cutoff rather than after it.
- **Deactivated before this change.** No cutoff was recorded, so Settings reads
  "Access ended Not recorded" rather than inventing a time.
- **Deleted account.** Treated as inactive rather than as an error, so a session
  outliving its row signs out instead of crashing.
- **Demo account.** The demo advisor is an ordinary active account and is
  unaffected. Deactivating it would correctly stop the demo.
- **Database unavailable.** The resolver's read fails like every other query on
  the page. It is not treated as a sign-out, so an outage does not sign the
  store out.
- **The bookkeeping write fails or is skipped.** A read-only replica after a
  failover, a statement timeout, an exhausted pool - or the account being
  deactivated in the same instant, which makes the conditional write match no
  rows. The account read that decides access has already succeeded, so either
  outcome is logged and the request continues; `Last granted request` stays
  where it was. Raw SQL did not change that: the write is still wrapped, and a
  failed bookkeeping statement still cannot fail an authenticated request.
- **A store in a different timezone from the server.** The two times are
  formatted in the browser, so the admin reads them on their own clock rather
  than the server's UTC.
- **Ordinary sign-out and expired tokens.** Land on a plain login page with no
  notice, because nothing went wrong.
- **A session refused on a live account.** The advisor deactivated by mistake at
  01:00 and put back at 01:10 still holds a session older than that cutoff. She
  is refused, but her account is active, so she lands on a plain login page:
  telling her the account is no longer active would be telling her something
  untrue.

## Data Requirements

Reads `User.id`, `name`, `email`, `role`, `department`, `active`,
`accessEndedAt` and `lastSeenAt` once per authenticated request.

Two nullable columns on `User`:

- `accessEndedAt` - set when an admin deactivates the account, never cleared.
  Sessions older than it are refused, and Settings shows it as "Access ended".
- `lastSeenAt` - written on a request that was granted, and no more than about
  once a minute. The write is bookkeeping, so a skip or a failure is logged and
  ignored rather than refusing a request whose access has already been decided.

Both timestamps are written by the same two-part rule, and both parts are
needed. Each write carries `active = true` in its own WHERE, so whichever
statement takes the row lock second finds the row already switched off and
matches nothing. And each takes its clock reading from the database inside the
statement (`clock_timestamp() AT TIME ZONE 'UTC'`) rather than from JavaScript
before it, so the value is read once the lock is held. Choosing a time before
the statement is sent is what allows "Access ended 2:03, Last granted request
2:04": the deactivation picks 2:03, queues on a busy pool, and commits after a
request that picked 2:04. That contention is not a remote possibility here - the
moment an admin switches off someone who is using the app is the busiest instant
that account ever has, and it is the exact moment this record has to be right.

All three timestamps the cutoff reasons about - when a session began
(`signedInAt`), when access ended, and when a request was last granted - are
read from the database clock, so no two of them can disagree. The sign-in stamp
costs one extra `SELECT clock_timestamp()`, once per sign-in.

Being granted a request is not an edit to the account, so `lastSeenAt` is
written with raw SQL that leaves `User.updatedAt` alone; traffic does not move
it.

**Accepted limit.** The once-a-minute interval is a write-reduction heuristic
rather than a guarantee. It compares the app's clock against a database-written
value, so under clock skew it fires a little early or late. Nothing depends on
its precision - it only changes how often a bookkeeping row is touched - and
moving it into the statement would mean a no-op `UPDATE` on every authenticated
request to remove a drift nobody can observe.

Nothing is backfilled: existing rows start null on both, and no migration
invents a cutoff for accounts deactivated before this shipped. Those accounts
keep reading "Access ended  Not recorded", which is true - the product genuinely
does not know when it happened. Their old sessions are refused for carrying no
sign-in claim rather than by comparison against a fabricated time.

## Analytics / Success Metrics

No live usage metrics; this is a single-store product with seeded data. The
success signal is behavioural: after an admin deactivates an account, the next
request from that person is refused. Metric to track once real stores are on it:
time between a deactivation and the last successful request from that account,
which should be under one request rather than up to 30 days. Settings now shows
both halves of that measure to the admin directly.

## Risks

- One extra indexed primary-key lookup per authenticated request, plus at most
  one small write per account per minute. Every page in the app already makes
  several larger queries, so the cost is not meaningful.
- Reactivation costs a sign-in. Accepted: deactivation is usually a firing, and
  the convenience being given up belongs to the rare mistaken case.
- The deploy that ships this signs every staff member out once, because no
  session minted before it can prove when it began. Ordinary for a change of
  this kind, it happens exactly once, and it is the price of not writing a time
  into the access record that nobody can stand behind.
- `/api/auth/session`, NextAuth's own endpoint, still echoes the claims in a
  deactivated person's cookie back to them - their own name, email and role. It
  grants no access to store data, and nothing in the app reads it.
- A future entry point could authenticate on its own and reintroduce the gap.
  A test pins `src/lib/session.ts` as the only module allowed to read the
  session. It matches source text rather than parsing it, so it catches the
  common ways in rather than every one; an aliased import still slips past.

## Open Questions

- Should the sign-in form tell a deactivated employee their account is off
  rather than that the password is invalid? It is friendlier and this is an
  internal staff tool, but it also confirms a valid password to whoever is
  typing. Left as is for now.
- Should a manager, rather than only an admin, be able to read the access record?
  Settings is already visible to managers read-only, so today they can.

## Implementation Notes

`resolveAccount` in `src/lib/session.ts` owns the re-read. `getActiveSessionUser`
wraps it for route handlers and the login page; `requireUser` wraps it for pages
and, since 2026-08-14, for server actions too - `src/app/actions.ts` no longer
has an auth helper of its own, so a refused form redirects instead of throwing.

The cutoff is compared against `signedInAt`, a claim stamped once in the NextAuth
`jwt` callback at sign-in and copied forward untouched. The token's own `iat`
cannot be used: NextAuth re-encodes the cookie as the session refreshes, so a
deactivated browser polling `/api/auth/session` would walk its `iat` past the
cutoff and keep the access it just lost. The comparison itself lives in
`src/lib/session-cutoff.ts`, away from the Prisma import, so it can be unit
tested without a database. It is named `sessionCannotBeProvenCurrent` rather
than for the cutoff comparison, because a missing claim is refused before any
cutoff is consulted and the old name no longer described what it decides.

`resolveAccount` returns why it refused, not only that it did, so `requireUser`
can send an inactive account to the notice and a merely-too-old session on a
live account to a plain login page.

Settings renders the access record from the same `getSettingsData` query; no new
query, and no new page. The two times render through `LocalTimestamp`, a small
client component, because a deployed server has no idea what clock the admin is
reading against - Node defaults to UTC. It renders a placeholder on the server
pass rather than a UTC time the browser would then swap, so there is no flash
and no hydration mismatch. No dealership timezone setting was added: the reader
is standing in the store, so their own clock is the store's clock until the
product has more than one location.

The `lastSeenAt` write is wrapped so a failure is logged and swallowed. It runs
on the path every page, action and route handler takes, after the read that
decides access has already succeeded, and a bookkeeping timestamp must not be
able to turn a granted request into a 500.

## Validation

2026-08-12, first slice:

- `npx tsc --noEmit`, `npm run lint`, `npm test` (57 tests) all clean.
- Verified end-to-end against local seeded data, driving one session cookie
  through deactivation without re-minting it. A deactivated account gets a 307 to
  `/login?reason=inactive` on `/inbox` and on `/templates`, and 401 from all
  three session-backed route handlers: `POST /api/messages/send`,
  `POST /api/ai/ops-brief`, and
  `POST /api/ai/ops-brief/[insightId]/action`. A server action refuses the write
  by throwing, so the caller sees an error rather than the notice. `/login`
  returns 200 for a deactivated cookie rather than looping back to `/inbox`, and
  a session pointing at a deleted account row is refused without a Prisma crash.

2026-08-14, this slice:

- `npx tsc --noEmit`, `npm run lint`, `npm test` (64 tests, 12 of them in
  `tests/session-revocation.test.ts`) all clean.
- Driven end-to-end in Chrome against a freshly migrated and seeded local
  database. Signed in as the admin, pressed Deactivate on the service advisor,
  and her row immediately read `Inactive`, `Access ended Aug 14, 2026, 1:17 AM`,
  `Last granted request Aug 14, 2026, 1:16 AM` - the granted request earlier
  than the cutoff, as designed.
- Her live session, held in a separate cookie jar, then got 307 to
  `/login?reason=inactive` on `/inbox` and `/templates` and 401 from
  `POST /api/ai/ops-brief`. After reactivating her from the same admin screen,
  that cookie was still refused everywhere; a fresh sign-in returned 200.
  `signedInAt` in `/api/auth/session` did not move across those refreshes, which
  is what makes the cutoff hold.
- Part 1 as the end user: signed in as the advisor in the browser, opened a
  customer thread, deactivated her mid-session, then pressed Save note. The tab
  landed on `/login?reason=inactive` reading only "This account is no longer
  active." No note reached the database (`Message` count for that text: 0).

Later rounds, after review. Each acceptance criterion added above was driven
against a fresh migrated and seeded database rather than reasoned about:

- A deactivated account's live cookie redirects to `/login?reason=inactive`.
  After the account is reactivated, that same cookie redirects to a plain
  `/login`, and the notice string is absent from that page's HTML - the account
  is active, so saying otherwise would be false. A fresh sign-in returns 200.
- A second Deactivate on an already-inactive account reports 0 rows updated and
  leaves `accessEndedAt` byte-for-byte unchanged.
- `/login` renders no notice; `/login?reason=inactive` renders exactly one.

## Portfolio Notes

Found by using the product rather than reading the code: an admin action that
looked complete in the UI had no effect on anyone already signed in. The
product decision worth defending is scope. The tempting fix is a session store
or shorter token lifetimes; the actual problem was that authentication was
duplicated across five entry points and each one trusted a month-old token. One
resolver, five call sites converging on it, and a test that keeps the sixth from
drifting. The second decision was to spend a few lines on the message: a
correct sign-out that leaves someone staring at "invalid email or password"
converts a security fix into a support call.

The 2026-08-14 slice turned on one fact: deactivation is usually a firing. That
answered three questions at once. The notice loses its call to action, because
"ask an administrator" is either cruel or false hope to someone just let go. The
session ends on the account rather than on a device, because a fired advisor has
a phone as well as a laptop, and the convenience being traded away - not having
to sign in after a reactivation - belongs to the rare case where the admin picked
the wrong person. And the members list gains an access record, because the thirty
day hole survived unnoticed for so long precisely for want of a screen that said
what deactivating had done. That last one was the most valuable of the three and
the smallest: two lines of existing data, no new page.
