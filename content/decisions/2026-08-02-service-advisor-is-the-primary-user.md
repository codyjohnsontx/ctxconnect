# Decision: The service advisor is the primary user

> Historical record. Written before the product was renamed to **Attend** on
> 2026-08-03, and left with the name it used at the time. `CTX Chat` below means
> Attend. See [the rename decision](2026-08-03-product-renamed-to-attend.md).

## Date

2026-08-02

## Status

Accepted

## Context

CTX Chat was demoed to a product executive who did not understand what it was, and
kept returning to one question: *who is the user of this?* The answer never landed.

A read-only review of the app found why, and it was not a build-quality problem. The
engineering was sound and the AI was real inference. The arrangement was wrong:

- The demo signed the viewer in as the General Manager and landed on a manager
  dashboard, while the pitch described a different person.
- The screen that actually delivers the pitch - the AI Ops Brief - was two clicks
  deep and completely hidden below 1024px.
- "Reads every conversation" was not true. The AI ran on a button click, one
  conversation at a time.
- The README and ARCHITECTURE claimed the app served a public-facing website. It
  does not; every route redirects to login.

## Options Considered

1. **Name the service advisor as the primary user and rearrange the product around
   her.** One user, one screen, one sentence.
2. **Name the General Manager as the primary user.** The app already leans this way -
   the Command Center, the employee accountability table, and most of the seeded data
   are built for a manager.
3. **Keep "the dealership team" as the user and explain the breadth better.** Better
   demo narration, no product change.

## Decision

Option 1. The primary user is the **service advisor**, and the pitch is:

> CTX Chat reads every conversation a service advisor has and tells her what to do next.

Concretely that meant: point the demo at `service@ctxchat.local` and land it on
`/inbox`; make the AI ambient so "reads every conversation" is true; rank the inbox
by AI output; make the brief work on a phone; and stop claiming a website that does
not exist.

## Reasoning

Option 3 is what already failed. "Dealership team" is five different jobs, and a
product arranged around five jobs cannot explain itself in eight seconds. Narration
cannot fix a product that points somewhere else.

Option 2 is defensible on the current data model but not on the product. A dashboard
is legible only to someone who already holds the job it belongs to. A GM would read
it fine; a product executive with no dealership job to hang it on reads forty numbers
and no question. It also means the flagship screen is a status board, which is the
least differentiated thing in the app.

Option 1 puts the good part first. The conversation view with the AI Ops Brief -
summary, risk, escalation, next action, accept/dismiss, convert to task - is the
strongest screen in the product and it belongs to the advisor. A product arranged
around one person explains itself.

## Tradeoffs

- The Command Center stays in the app but leaves the pitch. Real work, deliberately
  not shown.
- Staff-to-staff messaging is dropped from the story entirely, not deferred inside
  it. Every sentence spent on it re-opens the "who is this for" question.
- The Experiment Readiness card and the demo-path callout came off the screen. The
  thinking is preserved in `docs/experiment-plan.md`, where it reads as rigour rather
  than as a mock-up.
- Cost went from zero-when-idle to a bounded recurring spend, because an ambient pass
  makes paid calls nobody clicked for.

## Portfolio Notes

The useful thing here is that the fix was almost entirely arrangement, not
construction. Three configuration-and-layout decisions - which account the demo signs
in as, where the brief renders, when the model runs - were the difference between a
product that answers "who is this for?" in one screen and one that could not answer
it in a whole meeting.

The second useful thing is what was cut. Staff-to-staff messaging was in the owner's
vision and does not exist in the product. The decision was to say so plainly on a
roadmap line and keep it out of the pitch, rather than gesture at it. Widening the
answer is what lost the room the first time.
