# PRD: A Half-Written Reply Survives the Queue

## Status

Built

## Date

2026-08-17

## Summary

The inbox punished its own navigation. A service advisor part-way through a reply who clicked a queue row to check something - which is what the queue is for - came back to an empty box. So did a reload. A part-written reply now stays with its conversation until it is sent or discarded, and leaves the machine when she signs out.

## Problem

The composer held the reply in component state and nothing else. Every route the advisor has for checking a fact mid-reply destroys it:

- clicking any other conversation in the queue,
- reloading, or being reloaded by a deploy,
- following an alert out of the rail and coming back.

Reproduced against `main`: typed a half-sentence on Renee Whitlock's thread, clicked the next queue row, came back - the box was empty, with no warning before and no notice after.

The cost is not the keystrokes. It is that the advisor learns not to leave a reply she is writing, which is the opposite of what a two-pane queue is for.

## Target User

The service advisor, mid-reply, on the one screen she spends her day in.

## Goal

Leaving a thread is safe. The box she comes back to holds what she left in it, and she can see that it will.

## v1 Scope

- The reply box keeps its contents per conversation, per signed-in user, in browser storage.
- Coming back to a thread - by queue row, by link, or by reload - restores the draft.
- The composer says "Saved as a draft on this device" while there is one, with a Discard draft control.
- Sending clears the draft. A send that fails keeps it: the send is what failed, not the writing.
- Signing out removes this advisor's drafts from the machine.
- A browser that refuses storage keeps working and stops making the promise.

## Non-Goals

- No server-side drafts, and so no draft that follows her to another device.
- No draft for the internal-note box or the create-follow-up form. They have the same defect; it is tracked separately rather than folded in here.
- No draft history or recovery of a discarded draft.

## Acceptance Criteria

- Given a half-written reply, when she clicks another queue row and returns, then the box holds what she typed.
- Given a half-written reply, when she reloads, then the box holds what she typed.
- Given a draft, when the box has content, then the composer says it is saved on this device and offers Discard draft.
- Given a sent reply, when the send succeeds, then the box and the stored draft are both empty.
- Given a signed-in advisor with drafts, when she signs out, then her drafts are gone from the machine and another user's are untouched.
- Given a draft written more than twelve hours ago, when she opens the thread, then the box is empty.

## Risks / Open Questions

- The draft is unsent customer-facing text sitting unencrypted in browser storage, on what is in practice a shared front-desk machine. Two things bound it: entries are keyed by user *and* conversation, and they are cleared on sign-out and expire after twelve hours. Neither covers a machine simply left signed in.
- The stored record carries the template blanks alongside the body. Nothing produces blanks yet, so it is always empty today - but it is the field that stops a restored draft re-enabling Send on a reply still reading `[pickup time]`, and putting it in the format now avoids a stored-format change later.

## Portfolio Notes

The decision worth showing is the storage life. The obvious answer is "keep it as long as possible", and it is wrong: the thing being kept is a customer's name and their unit, on a browser several people sign into across a day. A shift-length life plus a sign-out purge keeps the feature's whole benefit - nobody loses work inside a shift - and gives up only the case where losing it is the safer outcome anyway.
