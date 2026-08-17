# PRD: A Queue Row Says Whose Words Those Are

## Status

Built

## Date

2026-08-17

## Summary

The inbox queue previewed the newest message of any direction under the customer's name with nothing saying who wrote it, so an internal note or a colleague's reply read as something the customer had just said and was still waiting on. The row now names the voice whenever it is not the customer's.

## Problem

The queue row is where the service advisor decides whether to open a thread at all. It shows the customer's name in bold and, under it, the newest message body - with no attribution of any kind.

Reproduced against `main` on the seeded service queue: four of six rows previewed staff text as if a customer were waiting.

- "RO paid. Bike parked in service delivery row." under **Priya Patel**
- "Comeback on RO 48244. Same tech, same fork. Check the seal supplier lot." under **Grant Delaney**
- "AI Ops Brief note: Customer needs estimate approval before weekend trip..." under **Nina Caldwell**

Every one of those is the dealership talking to itself. Read as the customer's own words, each one changes what the row appears to need: a note to yourself becomes a customer question you have not answered.

The thread itself already answers this - every bubble is labelled. The row, which is what she actually reads, did not.

## Target User

The service advisor scanning her ranked queue.

## Goal

A row can be read correctly at a glance. She can tell a waiting customer from her own bookkeeping without opening the thread.

## v1 Scope

- A previewed outbound reply is labelled with its author: "You:" for the reader's own, first name for a colleague's, "Staff:" when the sender is gone.
- A previewed internal note is labelled "Note:" when it is hers, "Note from <first name>:" when it is not.
- An inbound customer message is left unlabelled.
- The label carries the voice's own colour: amber for a note, matching the note bubble in the thread; plain for a staff reply.

## Non-Goals

- No change to what the row previews - it is still the newest message.
- No surfacing of the customer's last unanswered question when staff spoke last. That is a real gap and it needs a row-height decision; tracked separately.
- No change to the thread's own bubbles, which were already labelled.

## Acceptance Criteria

- Given a thread whose newest message is an internal note by the reader, when she scans the queue, then the row reads "Note: ...".
- Given a thread whose newest message is a colleague's internal note, when she scans the queue, then the row reads "Note from Cody: ...".
- Given a thread whose newest message is her own reply, when she scans the queue, then the row reads "You: ...".
- Given a thread whose newest message is from the customer, when she scans the queue, then the row carries no label.
- Given an outbound message whose sender account no longer exists, when the row renders, then it reads "Staff:" and never "You:".

## Risks / Open Questions

- Labelling only the exception keeps the queue's default reading - the customer's voice - and spends no width on the common case. The trade is that "no label" now carries meaning, which is only legible once the labelled rows are visible beside it.
- The row query now includes the sender's name. It selects only `name`, because the full `User` row carries a password hash and the row is rendered from data sent to the browser.

## Portfolio Notes

The decision worth defending is labelling the exception rather than everything. Labelling every row is more consistent and reads worse: it spends the preview's two-line clamp restating the name already in bold above it, on the majority case, to disambiguate the minority one.
