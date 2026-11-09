# PRD: A Reply Clears the New-Message Alert

## Status

Built

## Date

2026-11-09

## Summary

A thread's "New customer message" alert now leaves the alert rail as soon as a staff reply on that thread is recorded as sent. Before, a thread the advisor already had open when the text arrived, or one she had marked unread, kept its alert after she answered it. An advisor who answers everything and closes nothing ended the day with a rail full of work she had already done.

## Problem

The rail is meant to be the list of customers who still need an answer. Opening an unread thread withdraws its new-message alert, but nothing withdrew it when the advisor answered. So a customer who texted while she had the thread on screen, or a thread she had put back to unread, stayed on the rail after her reply until somebody closed the thread.

## Target User

The service advisor working her rail, and the managers who read the same alerts on the Command Center.

## Goal

After a reply goes out, the rail and the Command Center stop listing that thread as waiting for an answer, and they list it again if the customer texts back.

## v1 Scope

- A staff reply recorded as sent withdraws that thread's `NEW_INBOUND_MESSAGE` alerts for every recipient. That covers the send itself, Twilio's status callback, and the reconciler that settles a send whose answer was lost.
- The alert is resolved in the same database transaction that records the reply as sent, so it cannot clear without the reply going out.
- A customer text that arrives after the reply was written keeps the alert standing, and any later text raises it again.

## Non-Goals

- Opening the thread, mark-as-read and assignment as triggers. Mark-as-read already withdraws this alert and is left as it is.
- The thread's other alerts. An unowned thread still has no owner, a failed text is still failed, and the response-time alert (`SLA_MISSED`) is cleared by its own rule.
- The other queued alert findings: deactivated staff, reassignment, and the performance of the newest-reply query.

## Decisions

- **A send still being confirmed does not clear the alert.** A reply handed to Twilio whose answer never came back (`SENDING`) may still turn out to have failed, and a failed reply answered nobody. The alert clears when that reply is later recorded as sent, by Twilio's callback or by the reconciler, and stays if it is recorded as failed.
- **A failure Twilio reports after accepting the text does not re-raise the alert.** If Twilio accepts the reply and later reports it undelivered, the new-message alert stays cleared. The `MESSAGE_FAILED` alert to managers is the record of that failure.
- **A reply answers the texts before it, not after.** If the customer texts again during the Twilio round trip, the alert stays, because that new text has not been answered.

## Acceptance Criteria

- Given a customer text has raised a thread's new-message alert, when a staff reply on that thread is recorded as sent, then the alert leaves the advisor's rail, its badge and the Command Center, for managers too.
- Given the same, when the reply fails (Twilio refuses it, or texting is not connected), then the alert stays.
- Given the reply's Twilio answer was lost, then the alert stays until the reply is settled. It clears if the reply settles as sent and stays if it settles as failed.
- Given a reply cleared the alert, when the customer texts again, then the alert is raised again.
- Given two threads with alerts, when one is answered, then the other thread's alert stays.

## Validation

- `tests/a-reply-answers-the-alert.test.ts` (needs a real Postgres): ten cases covering every criterion above, plus a customer text landing mid-send and the thread's other alerts. The six tests that depend on the fix fail against the previous send path.
- Run in the app locally, with a stand-in for Twilio: an inbound text raised "New customer message" for the advisor, and her reply from the open thread removed it from the rail and the Command Center. Before the fix, the same steps left the alert standing.

## Risks / Open Questions

- The "text after the reply" check compares the reply's timestamp, taken from the app's clock, with the inbound text's timestamp, taken from the database clock. `src/lib/sla.ts` makes the same comparison. Clock drift between the two could misjudge a text that lands within that drift of the reply.

## Portfolio Notes

Small change, picked from the alert-rail findings because it most directly makes the rail an accurate list of who still needs an answer. The product call was which moment counts as "answered": a reply recorded as sent, not one merely written, so a failed send never hides a waiting customer. No live usage metrics yet. Metric to track after launch: the share of new-message alerts still standing on threads whose newest message is a sent staff reply, which should be zero.
