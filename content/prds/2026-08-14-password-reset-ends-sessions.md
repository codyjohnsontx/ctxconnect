# PRD: Password Reset Ends the Session

## Status

Built

## Date

2026-08-14

## Summary

Resetting a staff member's password used to change what they type at the sign-in
form and nothing else. Every session already signed in on that account kept
working, for the rest of its 30-day life, on every device it was signed in on.
An admin resetting the password of an account they believed was compromised did
not evict whoever held the stolen cookie.

It now does. A reset stamps the same cutoff deactivation uses, so every session
that existed before it is refused on every device, while the account stays fully
active and the person signs in once with the new password.

## Problem

`resetStaffPassword` wrote a new `passwordHash` and stopped there. The session
resolver in `src/lib/session.ts` refuses a request in this order: when the
account is missing or inactive; then, whatever the account looks like, when the
session carries no sign-in timestamp at all; and only then, when the session was
minted at or before the account's `accessEndedAt` cutoff. A password reset moved
none of those, so it took effect at the next sign-in and never before it.

Two situations sit behind the same button:

- **A reset because something is wrong.** The advisor's laptop was stolen, or a
  password was shared. The admin's mental model is "that person is locked out
  now". The product did not do that.
- **A routine reset.** Someone forgot their password. Signing them out of the
  phone in their pocket is a cost with no benefit, and they may be mid-thread
  with a customer.

Found on 2026-08-14 while reviewing
[Deactivation Ends the Session](./2026-08-12-deactivation-ends-the-session.md),
which built the primitive that closed it.

## Target User

The dealership admin or GM who resets a password, and the advisor whose password
is reset while they are working.

## Goal

An admin should be able to tell, from the product, whether resetting a password
has cut off existing access - and be right.

## Background

The deactivation slice added `User.accessEndedAt`: a cutoff stamped on the
account, against which every session is measured, on every device. Stamping it
*without* setting `active = false` ends every existing session while leaving the
account fully usable - which is exactly "reset the password and sign them out
everywhere". The mechanism was already built, tested and in use, so this slice
reuses it rather than adding a second way to invalidate a session.

The rule itself lives in `src/lib/session-cutoff.ts` and did not change here.
Two properties of it matter to anyone reading this document:

- The comparison is `<=`. A session minted **at or before** the cutoff instant is
  refused, not only one minted strictly before it. The two values are rounded by
  different paths, and a tie resolves against access.
- A session carrying no sign-in timestamp is refused outright, before any cutoff
  is consulted, whether or not the account has one. Those sessions cannot show
  when they began.

## Decision

Every reset ends every session on that account. Recorded in
[Password reset signs the account out everywhere](../decisions/2026-08-14-password-reset-signs-out-everywhere.md),
along with the two candidates that were rejected.

## Current Workaround (before this shipped)

An admin who wanted a reset to take effect immediately could press **Deactivate**
and then **Reactivate**, which stamped the cutoff. It was not discoverable, and
nothing on the members screen suggested it. It is no longer needed for this.

## v1 Scope

- `resetStaffPassword` writes the new hash and stamps `accessEndedAt` in one
  statement, leaving `active` alone.
- The admin who resets their own password is redirected to the login page with a
  reason, and the login page names it.

## Non-Goals

- Changing how deactivation works. That is settled and shipped.
- Self-service password reset, which the product does not have. Admin reset from
  `/settings` is the only reset path, so there is no second surface to change.
- Session management as a general feature - listing a person's devices,
  revoking one of them, or showing where they are signed in.
- Telling everyone else whose password was reset why they were signed out. See
  Edge Cases.

## User Flow

1. An admin opens `/settings`, types a new password on a staff member's row, and
   presses **Reset**.
2. The account's `passwordHash` and `accessEndedAt` are written in one statement.
3. That staff member's next request, on any device, is refused and lands on the
   plain login page. Nothing was destroyed in their browser; the cookie is simply
   no longer accepted.
4. They sign in with the new password and carry on. Their account was never
   inactive.

When the admin resets **their own** password, step 3 is their own next request,
so the action redirects them straight to `/login?reason=password-changed`, which
reads: "Your password was changed, which signed this account out everywhere. Sign
in with the new password."

## Requirements

- A reset must end sessions on every device, not only the one that would next
  contact the server.
- A reset must not deactivate the account.
- Every reset moves the cutoff, including a second reset a minute after the
  first. Deactivation guards its write on `active = true` because a repeat press
  is not a real transition; a reset has no such state.
- The audit row is written for the reset that happened, including a self-reset.

## User Stories

- As an admin, I want resetting a compromised account's password to cut off
  whoever is holding its session, so that the reset does what I believe it does.
- As an advisor whose password was reset, I want my account to still work, so
  that signing in again is all it costs me.
- As an admin who reset my own password, I want to understand why I am back at
  the sign-in form, so that a successful action does not read as a fault.

## Acceptance Criteria

- Given a staff member signed in on two devices, when an admin resets their
  password, then the next request from each device is refused.
- Given that reset, when the staff member signs in with the new password, then
  they reach the inbox normally - the account was never deactivated.
- Given that reset, when an admin looks at that person's row in `/settings`, then
  no access record is shown, because the account is still active.
- Given an admin resetting their own password, when the form submits, then they
  land on the login page with the changed-password notice rather than on a bare
  login page or an error screen.
- Given an admin resetting their own password, when the reset completes, then the
  audit row for it is still written.
- Given a reset that matches no account row, when the action runs, then it raises
  rather than reporting a reset that did not happen.

## Edge Cases

- **The admin resets their own password.** Nothing prevents it, and it ends their
  current session like anyone else's. That is correct - a reset that skipped the
  resetter would not do what it says - so the action redirects that one request
  with a reason instead of suppressing the behaviour.
- **The admin's other devices.** They get the plain login page, not the notice.
  Only the request that performed the reset knows what happened; the cutoff
  records when access ended, not what stamped it.
- **Everyone else whose password is reset.** Same plain login page, for the same
  reason. Telling them their account is inactive would be false, and inferring
  "your password was changed" from a cutoff alone is not something the data
  supports - a cutoff from a mistaken deactivate-then-reactivate looks identical.
  Closing that would mean a second timestamp on the account, which is a data
  model change this slice did not need.
- **A reset while the person is signed in mid-thread.** They lose nothing already
  sent; the next page load asks them to sign in.
- **Two resets in quick succession.** The second moves the cutoff again, so a
  session minted between them is refused too.

## Data Requirements

No schema change. The reset writes `passwordHash`, `accessEndedAt` and
`updatedAt` on `User`, and appends the existing `user.resetPassword` audit row.
The clock reading comes from the database inside the statement, for the reason
`recordLastSeen` in `src/lib/session.ts` documents.

`accessEndedAt` now means "the moment this account last lost its existing
sessions" rather than "the moment it was switched off". `/settings` shows it only
for inactive accounts, so a reset does not put an "Access ended" line against
someone who is working normally.

## Analytics / Success Metrics

No real usage metrics - this is a single-store product with no live install.

- Expected outcome: an admin who resets a compromised account's password has
  actually cut off whoever held the session, without having to know the
  deactivate-then-reactivate trick.
- Signal to watch after launch: resets that are immediately followed by a
  deactivation, which would mean the admin did not believe the reset was enough.

## Risks

- A routine reset is now disruptive: the forgetful advisor is signed out of every
  device, including the phone in their pocket. Accepted deliberately - see the
  decision log.
- An admin can sign themselves out by resetting their own password. Intended, and
  explained on the login page rather than prevented.

## Validation

- Reproduced first on the unchanged code: an advisor signed in on one client
  kept reaching `/inbox` after an admin reset their password from `/settings` in
  a browser, with `accessEndedAt` still null.
- With the change, the same reset left that client refused (`/inbox` → `/login`)
  while `accessEndedAt` was stamped and `active` stayed true; the old password
  was rejected at sign-in, the new one worked, and `/settings` showed no access
  record for the still-active account.
- An admin resetting their own password in the browser landed on
  `/login?reason=password-changed` with the notice rendered; a second client
  holding the same admin's session was refused on its next request; signing in
  with the new password restored access; the audit row was written.
- `npm test`, `npx tsc --noEmit`, `npm run lint`, `next build`.

## Portfolio Notes

This document arrived carrying two phrasings that had just been corrected
everywhere else in the repository - "predates" for a boundary that is now "at or
before", and a list of refusal rules missing the one with the biggest
operational consequence. Both were fixed on review, one round after the
corrections that should have prevented them. A new document is where corrected
wording goes to die: the fix lands in the files that had the error, and the next
file written from memory reintroduces it.

The two-line change was available while the deactivation branch was still open,
and was deliberately left out of it. "Should a routine password change sign
someone out of every device" is a product decision about a security-sensitive
behaviour, and answering it inside a change about deactivation would have decided
it by implication rather than on purpose. Holding it cost one extra branch and
bought a decision that was actually made. The answer, when it came, was the one
the deferred change would have implemented anyway - which is the point: it is now
a choice with a recorded reason rather than a side effect.
