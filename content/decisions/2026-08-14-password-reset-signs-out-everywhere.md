# Decision: A password reset signs the account out everywhere

## Date

2026-08-14

## Status

Accepted

## Context

`resetStaffPassword` wrote a new `passwordHash` and nothing else, so every
session that existed before the reset kept working for the rest of its 30-day
life, on every device. The usual reason to reset someone's password is that it
may be compromised, and whoever held a stolen session carried straight on.

The mechanism to close it already existed: the deactivation slice added a cutoff
on the account (`User.accessEndedAt`) that every session is measured against.
Stamping it without setting `active = false` ends every session while leaving the
account fully usable. So the question was never how, only whether - and one
reset button covers two different situations. A compromised password wants the
sessions gone; a forgotten password does not obviously want the advisor signed
out of the phone in her pocket mid-thread.

## Options Considered

1. **Every reset ends every session on the account.**
2. **The admin chooses**, with a checkbox on the reset form defaulting to ending
   them.
3. **Neither** - leave the behaviour and document the deactivate-then-reactivate
   workaround on the members screen.

## Decision

Option 1. Every reset ends every session on that account, on every device.

## Reasoning

The two situations are not distinguishable at the moment the button is pressed,
and the failure directions are not symmetric. Getting it wrong on a compromised
account leaves an intruder inside a system that holds customer conversations.
Getting it wrong on a forgetful advisor costs her one sign-in.

Option 2 hands that judgement to the admin at the worst possible moment - under
time pressure, having just been told a password was shared - and a security
control that defaults to on and can be switched off is one that will be switched
off by the person in a hurry. It also adds a control to a screen the deactivation
work deliberately kept quiet.

Option 3 keeps the gap between what an admin believes a reset does and what it
does, which is the same class of problem the deactivation slice existed to fix,
and leaves the remedy behind a two-click trick nothing on the screen mentions.

An admin can reset their own password and sign themselves out by doing it. That
is correct behaviour, not an edge case to suppress: a reset that skipped the
resetter would not be the rule this decision chose. It is handled by explaining
it - that one request redirects to the login page with a reason - rather than by
blocking it.

## Tradeoffs

- A routine "I forgot my password" reset is now disruptive. The advisor is signed
  out of every device, not only the one she forgot the password on, and loses
  whatever page she had open.
- Nobody except the admin who performed the reset is told why they were signed
  out. The cutoff records when access ended, not what stamped it, and inferring
  a reason from it would mean a second timestamp on the account - a data model
  change this did not need. Everyone else gets the plain login page.
- The rule is now enforced by one timestamp doing two jobs: it is both the
  enforcement boundary and the "Access ended" time an admin reads on `/settings`.
  The generation-counter design noted in the deactivation PRD would separate
  them; this decision does not build it. Because one value carries both, a reset
  stamps the cutoff only while the account is active. On a live account that
  stamp is the whole mechanism, and every reset must move it. On an account that
  is already deactivated, that same value is the deactivation record, and moving
  it would replace the moment the person lost access with an unrelated later
  time - while ending nothing, since an inactive account is refused before the
  cutoff is consulted and cannot mint a session in the first place. Resetting the
  password of a deactivated account therefore writes the new hash and leaves the
  record alone.

## Portfolio Notes

The decision this records is not "add the two lines" - the two lines were
available, working and tested a branch earlier. It is choosing a default for a
security control by asking which way the failure hurts, rather than by adding a
checkbox and calling the choice flexibility. The checkbox looks like the
considerate option and is the one that quietly fails: it moves a judgement onto
the person least able to make it, at the moment they are least able to make it.

See [Password Reset Ends the Session](../prds/2026-08-14-password-reset-ends-sessions.md).
