# PRD: Follow-Up in One Click

## Status

Built

## Date

2026-08-17

## Summary

The AI Ops Brief's "Use as follow-up" is the product's headline action, and it had two defects. It would happily create a second copy of a follow-up the thread was already tracking, and the form it filled could not be submitted without opening a date picker. It now refuses to duplicate, shows the advisor the follow-up that already exists, and hands her a form she can submit as it stands.

## Problem

**The brief recommends a follow-up from the same thread history that produced the follow-ups already on the board**, so it regularly recommends one that is already there. Nothing checked.

Reproduced against `main` on Renee Whitlock's thread. The open follow-up reads "Escalate GS warranty claim to service manager". The brief's suggested follow-up reads "Escalate GS warranty claim to service manager" - identical. Pressing "Use as follow-up" and submitting left the thread with two identical open follow-ups, both counted in the queue, both alerting, both needing to be closed.

**The form could not be submitted as filled.** "Use as follow-up" set the title and left `dueDate` - a `required` `datetime-local` input - empty, so the browser refused the submit. The one-click action was in fact a click, a date picker, and a submit.

## Target User

The service advisor acting on a brief, which is the interaction the whole product is pitched on.

## Goal

Acting on the brief's recommendation either adds a follow-up or shows her the one that already covers it, and never quietly makes two.

## v1 Scope

- The panel compares the suggested title against the thread's open follow-ups, ignoring case, punctuation and spacing.
- On a match, the Suggested follow-up field carries a note naming when the existing one is due.
- On a match, the action becomes "See the follow-up" and takes her to that follow-up in the panel, where it highlights.
- The create-follow-up form's due date is prefilled: the end of today when that is at least two hours out, otherwise tomorrow morning.
- The due field gets a visible label, which it did not have.

## Non-Goals

- No fuzzy matching. Only exact word-for-word repeats are caught; a follow-up phrased differently but meaning the same thing still gets through, and that is the advisor's call.
- No comparison against closed follow-ups. A finished one should not block a new one.
- No change to what the brief suggests, and no change to `createTask`.

## Acceptance Criteria

- Given a thread whose open follow-up matches the brief's suggestion, when the advisor reads the brief, then it says "Already on this thread, due ..." and the action reads "See the follow-up".
- Given that state, when she uses the action, then the existing follow-up is scrolled to and highlighted, and no follow-up is created.
- Given a suggestion the thread does not already track, when she presses "Use as follow-up", then the title fills and the form submits without her touching the date.
- Given the prefilled due date, when it is late in the day, then it lands tomorrow morning rather than in the past.

## Risks / Open Questions

- **This changes the demo.** `docs/demo-script.md` Click 3 is "Use as follow-up" on Renee Whitlock, introduced as "the part I care about most", and the seed gives that thread a follow-up whose title is identical to the brief's suggestion. That click now shows the existing follow-up instead of creating one, which demonstrates the de-dupe rather than the creation. Three ways out: change the seed so the titles differ, move Click 3 to another thread, or keep it and narrate the de-dupe. Not decided here - the demo script and seed are untouched.
- The default due date is computed on the server, not in the browser: `defaultFollowUpDueDate(new Date())` runs in `src/components/inbox-view.tsx`, a Server Component, and its value is rendered into the `datetime-local` input before the browser sees the form. So the time she is handed is the server's wall clock rather than her own - on a UTC host, an advisor in Central time opens the form on 17:00 meaning noon. Accepted as-is and filed as its own open item: computing it client-side would split date defaulting across client and server and invite a hydration mismatch.
- Whatever she submits is stored through `createTask`, which parses a bare local-time string on the server. Pre-existing and tracked separately; this change adds a default to that path but not a second writer.

## Portfolio Notes

The scope decision worth defending is refusing fuzzy matching. Catching "Escalate the GS warranty claim to the service manager" as a duplicate of "Escalate GS warranty claim to service manager" is tempting and would be wrong the first time it blocks a genuinely different follow-up the advisor meant to add. Exact-words-only is a rule she can predict, and a duplicate that slips through costs her one deletion; a false block costs her the feature.
