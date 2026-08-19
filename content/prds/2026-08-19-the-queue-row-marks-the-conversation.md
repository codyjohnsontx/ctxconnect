# PRD: The Queue Row Marks the Conversation, Not the Preview

## Status

Built

## Date

2026-08-19

## Summary

A reply the customer never got read as undelivered in three places: the queue
row, the thread bubble, and the composer banner. The row's marker was keyed to
the message it happened to be previewing, so the moment anyone wrote anything
afterwards the row went quiet while the other two still warned. The marker now
asks whether the conversation is still carrying an undelivered reply, and it
says so on its own line above the preview.

## Problem

The queue row loads exactly one message to preview, and that is the newest of
any direction - a customer message, an internal note, or a reply. The marker
asked `isUndelivered` about that message, which answers a different question
than the one the row is there to answer.

Reproduced against the pre-fix code in the running app on real Postgres, signed
in as the service advisor (`parts@ctxchat.local`), on the seeded Marco Silva
thread. It carries a reply the carrier rejected and an internal note written
after it:

- The queue row previewed "Note from Cody: Rear tire ETA slipped from supplier;
  check alternate distributor." with no marker of any kind.
- Opening the thread showed the bubble above it in red: "Not delivered - the
  customer never got this. / Carrier rejected message: unreachable destination."
- The composer offered the unsent body back, because it asks
  `lastUndeliveredOutbound`, which was already reading the newest reply rather
  than the newest message.

So the product disagreed with itself on the one surface the advisor scans to
decide what needs attention. A row that never spoke would have been better than
one that stopped: she reads a normal-looking row, skips it, and the customer
keeps waiting on a text that was never sent. Anything written after a failure
triggers it, and something usually is - a note, or the customer chasing the
reply she never got.

The prefix had a second problem where it did show. It rendered as **Not
delivered:** in front of the preview text, which reads as a claim about the text
beside it. In the superseded case that text is not the failed reply at all.

## Target User

The service advisor scanning her ranked queue. The row is where she decides
whether to open a thread, so it is the row that has to be right.

## Goal

The queue, the thread, and the composer answer the delivery question the same
way, whatever has been written since the reply failed.

## v1 Scope

**The rule moved into the shared module rather than into the component.**
`src/lib/message-delivery.ts` is what all three surfaces already read, so it now
carries the question in two pieces: `newestReply(messages)` finds the last
OUTBOUND message, and `hasUndeliveredReply(reply)` answers whether the
conversation is still carrying one the customer never got. The pre-existing
`lastUndeliveredOutbound` was rebuilt on top of both, so the surface that flags
the failure and the surface that hands the text back cannot drift apart again.
Its behaviour is unchanged and its tests were not touched.

**"Undelivered" means the newest reply failed, not that anything ever failed.**
That is the semantics `lastUndeliveredOutbound` already documented and the
composer banner already used: a later inbound message or internal note does not
undo the failure, but a later reply that did go out means she has moved past it.
Defining it as "any failure ever" would have made the row disagree with the
composer banner, which is the disagreement this work exists to remove.

**The queue query hands each row its newest reply.** `getInboxData` in
`src/lib/data.ts` runs a second `message.findMany`, distinct on
`conversationId` and ordered `conversationId` ascending then `createdAt`
descending so Postgres can answer it as a `DISTINCT ON` against the existing
`@@index([conversationId, createdAt])`. The preview include could not also carry
it, because Prisma cannot include the same relation twice with different
arguments. It sits in the same `Promise.all` as the other queue queries, so it
does not add a round trip.

**The marker moved off the preview line.** It renders `UNDELIVERED_ROW_LABEL` -
"Reply not delivered" - with the alert icon on its own line above the preview,
instead of a red **Not delivered:** prefix. This is part of the fix rather than
a restyle: a prefix is read as describing the text it sits in front of, and in
the case being fixed that text is somebody's internal note.

**The preview keeps its author label.** The old code suppressed it whenever the
reply had failed, on the reasoning that the prefix was both the more urgent fact
and already proof that staff wrote it, and that two labels would fight for a
two-line clamp. Neither holds once the marker has its own line, and with a note
previewing, the label is the thing that tells her whose words she is reading.
See [A Queue Row Says Whose Words Those Are](./2026-08-17-a-queue-row-says-whose-words-those-are.md).

## Non-Goals

- **Narrowing the Failed inbox filter.** It still matches any conversation that
  has ever had a delivery failure, so it can list a row whose later reply did
  go out and which is therefore correctly unmarked. What that filter should
  mean - every past failure, or only the ones still outstanding - is a product
  decision about the filter, not part of making the marker honest.
- **Any other queue styling.** Only the marker's placement changed.
- **Delivery handling.** Send, retry, webhooks, and what gets written to
  `deliveryStatus` are untouched. The bug was entirely in how a correct stored
  state was read.
- **The thread bubble, the composer banner, the template blanks and the length
  guard.** All unchanged; see
  [Attend Stops Asserting What It Does Not Know](./2026-08-17-attend-stops-asserting-what-it-does-not-know.md)
  and [The Length Guard Reads the Reply](./2026-08-18-the-length-guard-reads-the-reply.md).

## Acceptance Criteria

- Given a conversation whose failed reply is followed by an internal note, when
  the advisor scans the queue, then the row reads "Reply not delivered" above
  the preview, and the preview still names the note's author.
- Given that same conversation, when she opens it, then the thread bubble and
  the composer banner say what the row said.
- Given a failed reply that is still the newest message in its thread, when she
  scans the queue, then that row is marked the same way.
- Given a later reply that did reach the customer, when she scans the queue,
  then the row is not marked.
- Given a conversation staff have never replied to, when she scans the queue,
  then the row is not marked.

## Risks / Open Questions

- **The Failed filter can now list an unmarked row.** Named above as a
  deliberate non-goal, and worth watching: an advisor who filters to Failed and
  sees a row with no marker is looking at the filter's older meaning, not at a
  marker that is missing.
- **A marked row is a line taller.** The marker takes its own line rather than
  sharing the preview's two-line clamp. Accepted: it costs height only on the
  rows that need attention, and the alternative is the prefix that caused this.
- **The row asks its question of one preloaded message.** `hasUndeliveredReply`
  is only as right as the message handed to it, which is why the query that
  selects it and the note explaining why sit next to each other in
  `src/lib/data.ts`. A caller that passes the previewed message instead gets the
  old bug back silently, so the module's doc comment names that mistake.
- No live usage metrics; the product has no real dealership traffic. The signal
  to watch is whether an undelivered reply is ever visible in the thread while
  its row is unmarked - it should now be impossible, and a report of it means
  a surface has stopped reading the shared module.

## Portfolio Notes

The interesting part is that the shared module was already there and already
correct. Two of the three surfaces asked it the right question, because they can
see the whole thread. The third could not - it holds one message - so it asked
the only question it could, and that question is right exactly until somebody
writes anything. The fix was not a new rule but giving the third surface the
input the rule needs, and putting the conversation-level question in the module
so the next surface cannot improvise its own.

The test is the other half. A test asserting "a failed reply is the newest
message, so the row is marked" passes against the broken code and proves
nothing. The one that mattered had to encode the ordering - failed reply, then a
later message - and was watched failing before the fix was trusted.
