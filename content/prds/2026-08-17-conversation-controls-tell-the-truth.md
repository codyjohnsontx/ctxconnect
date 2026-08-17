# PRD: Conversation Controls Tell the Truth

## Status

Built

## Date

2026-08-17

## Summary

The Conversation controls panel showed a value the database did not hold, and offered a Save that wrote it back. A service advisor who changed a thread's priority saw the panel snap to the old value, pressed Save again, and silently undid her own change. The same panel is also where she hands a thread to another department, and that save replaced her open conversation with a bare 404.

## Problem

Two defects on one panel, both of which end with the advisor believing something false about her own work.

1. **The change is undone without her knowing.** The four selects were uncontrolled inputs inside a `<form action={updateConversation}>`. React resets an uncontrolled form once its action resolves, and the reset restores the values the selects were *mounted* with. So a save that worked looked exactly like a save that failed. Pressing Save again - the obvious response - posted the mounted values over the ones just written.

   Reproduced against `main` on Renee Whitlock's thread: priority Urgent → Low, Save. The database held `LOW`; the panel read `URGENT`. Second press, and the database held `URGENT` again. Nothing on screen said the change had been reverted.

2. **A hand-off looks like the app lost her place.** Routing a thread to another department is a normal end-of-day action, and it is the one save that removes the thread from the person making it. The thread page then re-rendered for a conversation she may no longer read, and `notFound()` gave her `404 - This page could not be found` where her conversation had been.

## Target User

The service advisor, on the panel she uses to assign, prioritise, close and hand off every thread she works.

## Goal

The panel never shows a value the database does not hold, Save is offered only when there is something to save, and a hand-off ends on the queue with the hand-off named rather than on a 404.

## v1 Scope

- The panel holds its own draft, adopts whatever the server last rendered, and offers Save only while the two differ.
- A pending change that would move the thread out of the advisor's reach says so before the click.
- A save that hands the thread away redirects to `/inbox?movedTo=<department>`, and the queue names the hand-off.
- A rejected save says so instead of looking like nothing happened.
- The conversation access rule moves to a database-free module so the queue query, the server-side guard and the panel all read one rule.

## Non-Goals

- No change to what `updateConversation` writes, or to who may write it.
- No undo of a hand-off, and no note recording who routed it or why. Both are tracked separately.
- No change to the assignment system note or its timestamp.

## Acceptance Criteria

- Given a thread at Urgent, when the advisor picks Low and saves, then the panel reads Low and Save is unavailable until she changes something else.
- Given a saved panel, when she presses Save, then nothing is posted - there is no press to make.
- Given a colleague changed the same thread in another tab, when the page re-renders, then the panel adopts their values rather than keeping stale ones.
- Given a pending department change that would remove her access, when she looks at the panel, then it says the thread will leave her inbox before she presses Save.
- Given she completes that hand-off, when the save lands, then she is on `/inbox` with "Handed off to Parts. That conversation has left your inbox." and not on a 404.
- Given she then opens another thread, when the queue link is followed, then the hand-off notice does not follow her.

## Risks / Open Questions

- The controls panel became a client component, so the assignee picker's staff list crosses the server/client boundary. The query is now `select`-ed to `id` and `name` so password hashes stay out of the page payload. Two other unselected `user.findMany` calls remain server-only; tracked separately.
- Adopting the server's values discards an in-progress edit when somebody else changes the same thread. That is the honest behaviour - the alternative is showing her a value nobody holds - but it is a real trade.

## Portfolio Notes

The interesting half is that the visible symptom (a select snapping back) and the damaging one (a second press reverting real data) are the same defect, and only the second one costs anything. Proving it meant driving the app as the advisor and reading the database behind the screen, rather than trusting either on its own.
