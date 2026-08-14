# PRD: Deactivation Ends the Session

## Status

Draft

## Date

2026-08-12

## Summary

Turning a staff account off in Settings did nothing to the person's current
session. Their sign-in token stays valid for 30 days and nothing re-checked the
account behind it, so a deactivated advisor kept full read and write access to
the dealership inbox until the token expired on its own. Every authenticated
request now resolves the account from the database, so deactivation takes effect
on the next request. A page request redirects to the login screen, which explains
that the account is no longer active. Server actions and API routes reject the
request instead: the write does not go through, but the person is not shown that
explanation.

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
than succeeding for up to 30 days. A page request lands on the login screen with
an explanation instead of a blank form or a crash; a server action or API call is
refused outright.

## Background

Sessions are JWT-based (`session.strategy = "jwt"`) with the NextAuth default of
30 days. Five entry points authenticated independently - the page helper, the
server-action helper, and three route handlers - and each one trusted
`getServerSession` on its own. There is no session revocation list, and adding
one is not necessary: the account row already carries `active`.

## v1 Scope

- One resolver, `src/lib/session.ts`, re-reads the account on every
  authenticated request and returns nobody when it is missing or inactive.
- All five entry points go through it. Pages redirect, server actions throw,
  route handlers return 401.
- Name, email, role and department come from the row rather than the token, so a
  future role change also takes effect on the next request.
- The login page resolves the same way, so a deactivated session is not bounced
  back to the inbox that just rejected it.
- The login page explains that the account is no longer active and cannot be
  used, and says who can reverse it.

## Non-Goals

- Clearing the stale session cookie. Every entry point rejects it, so it is
  inert, and a server render cannot write cookies.
- A shorter session lifetime, refresh tokens, or a revocation store.
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
4. On a page load she lands on the login page above an amber notice: her account
   is no longer active, so it cannot be used right now, and an administrator at
   her store can turn it back on.
5. A form submitted from a tab she already had open does not reach that notice.
   The server action throws rather than redirecting, and there is no error
   boundary under `src/app`, so that path ends on Next's generic error screen.
   The write is refused either way, and her next page load reaches the notice.
   Carrying the form path to the notice as well is follow-up work.
6. Signing in again fails at the credentials check, which already refuses
   inactive accounts.
7. When the admin reactivates her, she signs in normally and resumes.

## Requirements

- No module outside `src/lib/session.ts` may read the session directly.
- A missing account and an inactive account are treated identically.
- The deactivation notice appears only after a deactivation-triggered redirect
  to the login page, never after an ordinary sign-out or an expired token.
- An active user sees no behaviour change.

## User Stories

- As a dealership admin, I want deactivating an account to cut off access
  immediately, so that a departing employee cannot read customer conversations
  after they leave.
- As an advisor whose account was switched off mid-shift, I want to be told
  what happened, so that I ask the right person instead of retyping a password
  that will never work.

## Acceptance Criteria

- Given an advisor with a live session, when an admin deactivates her account,
  then her next page load redirects to the login page.
- Given that redirect, when the login page renders, then it shows the
  deactivation notice naming an administrator as the fix.
- Given a deactivated account, when any authenticated API route is called with
  its session, then the response is 401 and no data is returned.
- Given a deactivated account, when the login page is opened with its session
  cookie still present, then the login page renders rather than redirecting back
  to the inbox.
- Given a session whose account row no longer exists, when a follow-up is
  submitted, then the write is refused before it reaches the database rather
  than failing on a foreign key. The server action throws, so that tab shows an
  error screen rather than the login notice, and the next page load reaches the
  notice.
- Given an active account, when any page, form or AI action is used, then
  behaviour is unchanged.

## Edge Cases

- **Redirect loop.** The login page previously redirected any session holder to
  the inbox. With the inbox now rejecting deactivated sessions, that pairing
  would have looped; the login page resolves the account the same way.
- **Reactivation.** Sign-in works again with no cookie cleanup, because the
  resolver reads current state on every request.
- **Deleted account.** Treated as inactive rather than as an error, so a session
  outliving its row signs out instead of crashing.
- **Demo account.** The demo advisor is an ordinary active account and is
  unaffected. Deactivating it would correctly stop the demo.
- **Database unavailable.** The resolver's read fails like every other query on
  the page. It is not treated as a sign-out, so an outage does not sign the
  store out.
- **Ordinary sign-out and expired tokens.** Land on a plain login page with no
  notice, because nothing went wrong.

## Data Requirements

Reads `User.id`, `name`, `email`, `role`, `department` and `active` once per
authenticated request. Nothing new is written and no schema changes.

## Analytics / Success Metrics

No live usage metrics; this is a single-store product with seeded data. The
success signal is behavioural: after an admin deactivates an account, the next
request from that person is refused. Metric to track once real stores are on it:
time between a deactivation and the last successful request from that account,
which should be under one request rather than up to 30 days.

## Risks

- One extra indexed primary-key lookup per authenticated request. Every page in
  the app already makes several larger queries, so the cost is not meaningful.
- A future entry point could authenticate on its own and reintroduce the gap.
  A test pins `src/lib/session.ts` as the only module allowed to read the
  session.

## Open Questions

- Should the sign-in form tell a deactivated employee their account is off
  rather than that the password is invalid? It is friendlier and this is an
  internal staff tool, but it also confirms a valid password to whoever is
  typing. Left as is for now.

## Implementation Notes

`resolveAccount` in `src/lib/session.ts` owns the re-read. `getActiveSessionUser`
wraps it for actions and route handlers, and `requireUser` wraps it for pages,
distinguishing "no session" from "account gone" so only the second one gets the
notice. `src/app/actions.ts` and the three route handlers under `src/app/api`
lost their inline `getServerSession` calls, which also removed four copies of
the same auth check.

## Validation

- `npx tsc --noEmit`, `npm run lint`, `npm test` (57 tests) all clean.
- Verified end to end against local seeded data, driving one session cookie
  through deactivation without re-minting it. A deactivated account gets a 307 to
  `/login?reason=inactive` on `/inbox` and on `/templates`, and 401 from all
  three session-backed route handlers: `POST /api/messages/send`,
  `POST /api/ai/ops-brief`, and
  `POST /api/ai/ops-brief/[insightId]/action`. A server action refuses the write
  by throwing, so the caller sees an error rather than the notice. Reactivating
  the account makes the same cookie work again with no re-login, `/login` returns
  200 for a deactivated cookie rather than looping back to `/inbox`, and a
  session pointing at a deleted account row is refused without a Prisma crash.

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
