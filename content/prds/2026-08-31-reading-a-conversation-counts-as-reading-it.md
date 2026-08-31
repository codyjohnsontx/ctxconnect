# PRD: Reading a Conversation Counts as Reading It

## Status

Built

## Date

2026-08-31

## Summary

Nothing in Attend marked a conversation read. Opening a thread, reading it and
deciding it needed nothing left the blue dot, the Inbox count, the `Needs
action` filter and the Command Center tile all still counting it. The only ways
the marker ever cleared were replying or pressing Save on the controls panel -
both of which are doing work, not reading. Opening a thread now marks it read,
and the advisor can put it back to unread when she wants the floor to pick it
up.

## Problem

`Conversation.unread` is written `false` in exactly two places: the send route
and `updateConversation`. The inbound webhook writes it `true`. Reading was not
one of the transitions.

Reproduced in the running app as the service advisor: opening an unread seeded
thread, reading every message, and going back to the queue left the row with its
blue dot and left the header count unchanged. Refreshing did not help; the only
thing that cleared it was replying.

The marker feeds five surfaces, so one missing transition made five numbers
wrong at once:

- the blue dot on the queue row,
- the conversation count in the inbox header,
- the `Unread` filter,
- the `Needs action` filter, which ORs `unread: true` in,
- the Command Center's unread tile and its focus list.

The effect compounds. Every thread she has ever read stays in the count, so
within a day the number describes the dealership's history rather than her work,
and she stops reading it. A count that only ever grows is worse than no count.

## Target User

The service advisor working a shared queue. "What have I not looked at yet" is
the first question she asks it.

## Goal

The unread marker describes what she has not read.

## v1 Scope

**Opening the thread marks it read, from the browser.** `MarkReadOnOpen` is a
client component mounted in the thread pane that calls the
`markConversationRead` server action from an effect. It has to be an effect
rather than a render: Next prefetches the queue's links, so a render-time write
would mark threads read that she only hovered. It fires once per conversation
opened, tracked in a ref - marking it read makes `unread` false, which re-runs
the effect, and pressing Mark unread makes it true again; neither is her opening
the thread a second time.

**The write is conditional and quiet.** `updateMany` with `unread: true` in the
where, so re-opening an already-read thread does no write and triggers no
revalidation. A failure is swallowed rather than surfaced: the worst case is the
state she was already in, and it must not become an error over the conversation
she is trying to read.

**Mark unread is the way back.** The queue is shared. Leaving a thread flagged
is how an advisor hands work she cannot take right now back to the floor, so
reading clearing the marker cannot be the end of the story. The thread header
shows an `Unread` label while the thread is unread, and a **Mark unread**
button once it is not.

**Both actions are permissioned like every other write on the thread.**
`requireConversationAccess`, so a thread she cannot open is a thread she cannot
mark either way.

**Reading withdraws one alert and no others.** `NEW_INBOUND_MESSAGE` existed
only to say a message had arrived; she has now seen it. Every other alert -
`SLA_MISSED`, `MESSAGE_FAILED`, `UNASSIGNED_CONVERSATION`, both follow-up
states, both assignment states - describes work that is still undone after
reading, and withdrawing any of them would silence a clock that is still
running. The list lives in `src/lib/notification-facts.ts`, next to the other
rules about what an alert means, and its test enumerates every enum member so
adding a type is a decision somebody has to make rather than a default.

## Non-Goals

- **Marking an alert read.** `Notification.status` still only ever moves to
  RESOLVED; nothing marks one READ. That is a separate gap in the rail.
- **Per-user read state.** `unread` is one flag on the conversation, shared by
  everyone who can see it, which is what makes Mark unread meaningful. A
  per-advisor read model is a data-model change, not this.
- **Scroll or dwell heuristics.** The thread being painted for her is the
  signal. Requiring her to scroll to the bottom of a long thread would make
  reading harder than it is.
- **The queue's other counts.** The header still counts conversations, not
  unread ones; only the marker's truthfulness changed.

## Acceptance Criteria

- Given an unread conversation, when the advisor opens it, then the blue dot
  clears on her return to the queue and the `Unread` filter no longer lists it.
- Given that same conversation, when she presses Mark unread, then the dot and
  the filter carry it again.
- Given a conversation she has already read, when she opens it again, then no
  write happens.
- Given an unread conversation carrying an SLA alert, when she opens it, then
  the "new message" alert is withdrawn and the SLA alert still stands.
- Given a conversation in a department she cannot open, when the action is
  called for it, then it is refused.

## Risks / Open Questions

- **Hovering a queue row prefetches the thread.** The effect is what keeps a
  prefetch from counting as reading. A future refactor that moves the call into
  the server render would silently reintroduce that, which is why the reason is
  written at the call site.
- **`unread` is shared, not per-user.** Two advisors reading the same queue mark
  it read for each other. That is how a shared inbox should behave and it is why
  Mark unread exists, but it is a real constraint worth stating.
- **The read write happens after paint.** A slow action means a moment where the
  thread is open and the dot has not cleared. Acceptable; the alternative is
  blocking the render on a write.
- No live usage metrics. The signal to watch is whether the unread count ever
  goes down during a working day - before this, it structurally could not.

## Portfolio Notes

The bug was not in any of the five surfaces that were wrong. All five read
`unread` correctly; the state simply had no way to change. It is the cheapest
kind of defect to describe and the most expensive kind to leave, because each
surface looks individually defensible and the product only reads as broken when
you use it for a day.

The design question that took the longest was the smallest: an effect or a
render. Marking read during the server render is one line shorter and marks
threads read that the advisor only hovered over, because the framework prefetches
her queue for speed. That is the kind of thing that never shows up in a test and
shows up immediately in a demo.
