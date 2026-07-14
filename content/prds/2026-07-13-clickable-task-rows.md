# PRD: Clickable Task Rows

## Status

Ready for Build

## Date

2026-07-13

## Summary

Make each row on the Tasks page clickable so it opens the linked conversation thread, giving staff the message context before they act, while keeping the in-row status controls for quick changes.

## Problem

The Tasks page lists follow-ups tied to customers and conversations, but a task is a dead end: reading "Call Nina with estimate approval · Nina Caldwell · Service" gives no way to reach that thread. Staff must remember the customer, switch to the inbox, and hunt for the conversation before they can act.

## Target User

Dealership staff (GM, service, sales) working their follow-up list who need the conversation context behind a task before calling or texting the customer.

## Goal

From a task, reach the relevant conversation in one click — without losing the ability to update the task's status in place.

## v1 Scope

- Clicking a task row (title, metadata, or description area) navigates to `/inbox/<conversationId>` for its linked conversation.
- The status dropdown and Update button remain functional on the row; clicking them does not navigate.
- A hover affordance signals the row is clickable.
- Tasks with no linked conversation stay non-clickable (no thread to open).

## Non-Goals

- No task-detail or expand-in-place view (the in-row status control already covers acting on the task).
- No new customer-detail route for conversation-less tasks.
- No changes to the Command Center alerts or notifications lists (same pattern could extend there later).

## Acceptance Criteria

- Given a task with a linked conversation, when staff click the row body, then the app navigates to that conversation in the inbox.
- Given a task row, when staff click the status dropdown or Update button, then the status control behaves normally and no navigation occurs.
- Given a task with no linked conversation, when the row renders, then it is static (no link, no hover highlight) and its controls still work.
- Given any task row, when staff hover it (and it is clickable), then a background highlight indicates it is interactive.

## Risks / Open Questions

- Nesting the existing status `<form>` inside a link is invalid HTML; addressed with a stretched-link overlay so the form controls stay above the click target.
- All seeded demo tasks have conversations, so the conversation-less path is lightly exercised in the demo.

## Portfolio Notes

Small UX affordance with a real product decision underneath: the task list was a dead end, and the fix connects two existing surfaces (tasks → conversation) rather than adding new scope. Demonstrates "connect what exists before building more," plus an HTML-correctness constraint (form-inside-anchor) solved with the stretched-link pattern while preserving in-row actions.
