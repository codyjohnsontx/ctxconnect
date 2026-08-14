# PRD: Password Reset Ends the Session

## Status

Draft

## Date

2026-08-14

## Summary

Resetting a staff member's password changes what they type at the sign-in form
and nothing else. Every session already signed in on that account keeps working,
for the rest of its 30-day life, on every device it is signed in on. An admin
resetting the password of an account they believe is compromised does not evict
whoever holds the stolen cookie.

This PRD exists to hold that question, not to answer it. The mechanism to close
the gap already exists; what is undecided is whether closing it is the right
product behaviour, and for which kind of reset.

## Problem

`resetStaffPassword` writes a new `passwordHash` and stops there. The session
resolver in `src/lib/session.ts` refuses a request when the account is missing,
inactive, or its session predates the account's `accessEndedAt` cutoff - and a
password reset moves none of those. So the reset takes effect at the next
sign-in and never before it.

Two situations sit behind the same button, and they may not want the same
answer:

- **A reset because something is wrong.** The advisor's laptop was stolen, or a
  password was shared. The admin's mental model is "that person is locked out
  now". The product does not do that.
- **A routine reset.** Someone forgot their password. Signing them out of the
  phone in their pocket is a cost with no benefit, and they may be mid-thread
  with a customer.

Found on 2026-08-14 while reviewing
[Deactivation Ends the Session](./2026-08-12-deactivation-ends-the-session.md),
which built the primitive that would close it.

## Target User

The dealership admin or GM who resets a password, and the advisor whose password
is reset while they are working.

## Goal

An admin should be able to tell, from the product, whether resetting a password
has cut off existing access - and be right.

## Background

The deactivation slice added `User.accessEndedAt`: a cutoff stamped on the
account, against which every session is measured, on every device. Stamping it
*without* setting `active = false` would end every existing session while
leaving the account fully usable - which is exactly "reset the password and sign
them out everywhere". The mechanism is built, tested and in use.

So this is not a question of how. It is a question of whether, and for which
resets.

## Current Workaround

An admin who wants a reset to take effect immediately can press **Deactivate**
and then **Reactivate**. That stamps the cutoff, so every existing session on
the account is refused, and the person signs in once with the new password.
It works today and costs nothing but two clicks and one sign-in.

The workaround is not discoverable. Nothing on the members screen suggests it,
and an admin who does not know it will believe the reset did more than it did.

## v1 Scope

Undecided - that is what this PRD is for. The candidates:

1. **Every reset ends the sessions.** Simplest rule, easiest to explain, and
   safe by default. Costs the forgetful advisor a sign-in on every device.
2. **The admin chooses**, with a checkbox on the reset form, defaulting to
   ending them. Honest about the two situations, but adds a control to a screen
   the deactivation work deliberately kept quiet.
3. **Neither** - document the workaround on the members screen and leave the
   behaviour alone.

## Non-Goals

- Changing how deactivation works. That is settled and shipped.
- Self-service password reset, which the product does not have.
- Session management as a general feature - listing a person's devices,
  revoking one of them, or showing where they are signed in.

## Open Questions

These need answering before this is buildable:

- Which of the two situations above is the common one in a single store?
- If a reset ends sessions, what does the person see? The deactivation notice is
  wrong for them - their account is active. A plain login page is honest but
  says nothing about why they were signed out mid-shift.
- Does the admin need to be told what the reset did, the way the members screen
  now shows what deactivation did?
- Is a stolen-device case actually a deactivation rather than a reset? If the
  answer is "the admin should just deactivate them", this may need no code at
  all - only making that path obvious.

## Risks

- Ending sessions on every reset makes a routine, low-stakes action disruptive,
  and the advisor loses whatever they were in the middle of.
- Leaving it as-is keeps a gap between what an admin believes a reset does and
  what it does, which is the same class of problem the deactivation slice
  existed to fix.

## Acceptance Criteria

To be written once the open questions are answered.

## Portfolio Notes

Worth keeping as an example of not fixing something. The two-line change was
available, the mechanism was already built and tested, and the branch that found
it was open. It was still the wrong place: "should a routine password change
sign someone out of every device" is a product decision about a security-
sensitive behaviour, and quietly answering it inside a change about deactivation
would have decided it by implication rather than on purpose.
