# Decision: A Hand Reassignment Should End That Thread's Coverage

## Date

2026-09-08

## Status

Proposed

## Context

Coverage marks each moved thread with `Conversation.coveredForUserId`, the
advisor it goes back to. `updateConversation` - the assignee picker on the
thread page, which every reassignment in the application passes through - writes
`assignedUserId` and leaves that mark alone.

So a covered thread can be reassigned by hand and still be carrying a mark that
says coverage owns its fate. When the advisor comes back, the return has to
decide what to do with a thread somebody has already re-owned. Two of those
cases were wrong until 2026-09-08: a thread a manager routed to a parts
specialist was taken back off them, and a thread left with no assignee was
stranded with nobody at all.

Both were fixed inside the return, in `coverageDisposition`, by asking who is
holding the thread now. That works, but it treats a symptom: the mark should
arguably not have survived the reassignment in the first place.

## Options Considered

1. **Clear `coveredForUserId` in `updateConversation` whenever a covered thread
   is reassigned.** Reassigning a thread by hand is an explicit ownership
   decision, and it ends the coverage relationship for that one thread. Coverage
   stops tracking what a human has re-owned.
2. **Leave the mark and decide at return time by who holds the thread.** What is
   built. The mark stays write-once, and the return reads the world as it finds
   it.
3. **Refuse to reassign a covered thread at all.** Rejected without much
   argument: it blocks a normal, correct hand-off - routing a repair question to
   parts - because of a coverage record the person reassigning cannot see.

## Decision

Option 2 is what shipped. Option 1 is recorded here as the model we believe is
correct, to be taken up on its own.

## Reasoning

Option 1 is the better model. It makes the mark mean one thing - "coverage moved
this thread and is still responsible for putting it back" - instead of "coverage
moved this thread once, whatever has happened to it since". It would retire the
`alreadyHers` case entirely, because a thread reassigned back to the away advisor
by hand would no longer be carrying a mark at all.

It was not done here because it changes `updateConversation`, which every
reassignment in the application passes through, including reassignments that have
nothing to do with coverage. That is its own blast radius and its own validation,
and this change was already eight review rounds deep. Making the model change at
that point would have put an unvalidated write on the busiest path in the app.

## Tradeoffs

The return carries a rule it would not otherwise need, and `alreadyHers` exists
only because the mark can outlive the coverage it recorded.

Honestly: adopting option 1 would **not** remove the need for the unowned-thread
guard. A null assignee also arrives without anybody touching the picker - the
`assignedUser` foreign key is `onDelete: SetNull`, so deleting a staff account
nulls the assignment on every thread they held, mark included. A covered thread
can therefore be held by nobody however the mark behaves, and the return still
has to give it to somebody.

One case is left open either way, and is not fixed here: ending coverage with
"leave them with the cover" on a thread that has no assignee leaves it with no
assignee. Assigning it to the returning advisor would be wrong - she is the one
leaving, and her account may already be switched off - and assigning it to the
cover is behaviour no review round has asked for. The operational sweep does
raise `UNASSIGNED_CONVERSATION` to managers for it, so it is visible rather than
silent.

## Portfolio Notes

The interesting part is the second option being shipped over the better one on
purpose, and the reason being blast radius rather than effort. It also shows the
value of writing the enumeration down: the two defects were only obvious once the
four possible holders were crossed with the two reply outcomes and read as a
table.
