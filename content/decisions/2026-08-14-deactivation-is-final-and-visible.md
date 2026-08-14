# Decision: Deactivation Is Final and Visible

## Date

2026-08-14

## Status

Accepted

## Context

PR #19 closed the hole where deactivating a staff account changed nothing about
their access for up to thirty days. What it left behind was an experience that
was inconsistent, reversible, and invisible:

- a page load landed on a login notice, but a form submitted from a tab that was
  already open threw onto Next's raw error screen,
- access was refused but the session cookie stayed valid, so reactivating an
  account woke every browser the person still had open,
- pressing Deactivate produced no evidence that anything had happened, which is
  exactly why the thirty-day hole survived unnoticed for so long.

The product owner settled the fact the rest hangs on: **deactivation in a
dealership is usually a firing.** It is not a temporary pause and it is not
usually a mistake.

## Options Considered

1. **Treat deactivation as a pause.** Keep the notice helpful ("ask an
   administrator to turn it back on"), keep sessions alive so a reactivated
   person picks up where they left off, and leave the members list as it is.
2. **Treat deactivation as final.** One neutral sentence and nothing else, end
   the session on the account so it reaches every device and survives
   reactivation, and show the admin when access ended and when the person was
   last seen.
3. **Split the difference.** Final wording, but clear the cookie on whichever
   request happens to arrive and leave reactivation convenient.

## Decision

Option 2, all three parts.

The notice reads "This account is no longer active." and stops. The cutoff is a
timestamp on the account (`User.accessEndedAt`); every session is measured
against it, so a laptop, a phone and a tab left open at home are all refused,
and they stay refused after the account is switched back on. A deactivated
account's row in Settings shows when access ended and when it was last let
through a request.

## Reasoning

Someone who was just let go knows why. "Ask an administrator at your store to
turn it back on" is either cruel or false hope, and a support link invites a
conversation the store has already decided not to have. Saying less is kinder
here than saying more.

Option 3 fails on the facts of a firing: clearing a cookie only reaches the
device that asked, and a fired advisor has the app open on a phone as well.

The visible confirmation was the most valuable of the three and the smallest.
An admin action that produces no evidence is an admin action nobody can check,
and that is how a thirty-day access hole goes unnoticed. Two lines of data
already on hand, on a screen that already exists.

## Tradeoffs

- **Reactivation now costs a sign-in.** The only argument for the old behaviour
  was convenience in the case "we deactivated the wrong person" - which is the
  case where one extra sign-in costs nothing.
- **Sessions minted before this change are refused for any account that has been
  deactivated at least once,** because they carry no sign-in timestamp to compare
  against the cutoff. Same price: one sign-in.
- **Two nullable columns on `User`.** A session store or shorter token lifetimes
  would have been heavier and bought no more than one timestamp does.
- **The members list gains an access record but not an activity monitor.**
  Last-seen shows only once an account is switched off, which is the moment it
  answers a question someone is actually asking.

## Portfolio Notes

The decision worth defending is that one confirmed fact - deactivation is usually
a firing - answered three separate design questions at once: what the screen
says, whose convenience the session model protects, and who the feature owes
evidence to. Deciding the fact first is cheaper than arguing the three
individually, and it is why the tone question ("should we add a support link?")
never became a debate.

Related: [PRD - Deactivation Ends the Session](../prds/2026-08-12-deactivation-ends-the-session.md).
