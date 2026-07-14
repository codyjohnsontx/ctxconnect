# PRD: Tasks Status Views + Conversation Back Link

## Status

Ready for Build

## Date

2026-07-13

## Summary

Two navigation/organization improvements to the tasks workflow: (1) a contextual back link on the conversation view that returns staff to wherever they came from (Tasks or Customers), and (2) status views on the Tasks page — filter tabs plus grouped sections — so staff can organize follow-ups by Open / In Progress / Done / Canceled.

## Problem

- After clicking a task into its conversation, there's no one-click way back to the task list — staff have to use the browser back button or re-navigate.
- The Tasks page is a single flat list ordered by status then due date, with no visual separation, so it's hard to focus on active work vs. see what's done or canceled.

## Target User

Dealership staff working their follow-up list who move between a task and its conversation, and who want to focus on active work while still being able to review completed/canceled tasks.

## Goal

Make the tasks ↔ conversation round trip effortless, and let staff slice the task list by status.

## v1 Scope

**Back link (contextual):**
- When staff open a conversation from the Tasks page, the conversation header shows "← Back to tasks" linking to `/tasks`.
- When they open it from the Customers page, it shows "← Back to customers" linking to `/customers`.
- Opening a conversation from the inbox list (or directly) shows no back link — the inbox list is already the surrounding context.
- Navigating to another conversation via the inbox list clears the origin (no stale back link).

**Status views (both filter + grouping):**
- Filter tabs across the top: All / Open / In Progress / Done / Canceled, each with a count.
- Selecting a status shows only those tasks; "All" shows every task grouped into labeled sections by status (active statuses first).
- Empty statuses are omitted from the grouped view; an active filter with no matches shows an empty state.

## Non-Goals

- No task-detail/edit view beyond the existing in-row status control.
- No new customer-detail route.
- No persistence of the selected tab across sessions (it lives in the URL).
- No changes to Command Center or notifications.

## User Flow

1. Staff open `/tasks`, optionally click a status tab to filter, or scan the grouped sections.
2. Click a task → its conversation opens with "← Back to tasks" in the header.
3. Click back → return to `/tasks`.

## Acceptance Criteria

- Given a task opened from `/tasks`, when the conversation renders, then a "Back to tasks" link appears in the header and returns to `/tasks`.
- Given a conversation opened from `/customers`, then a "Back to customers" link appears; given one opened from the inbox list, then no back link appears.
- Given the inbox list is visible, when staff click a different conversation, then any prior "Back to tasks/customers" link no longer shows.
- Given the Tasks page, when staff click a status tab, then only tasks with that status are listed and the tab shows its count.
- Given the "All" tab, then tasks are grouped under Open / In Progress / Done / Canceled headers with per-group counts, empty groups omitted.

## Data Requirements

None new. `getTasks` (`src/lib/data.ts`) already returns tasks with `status`, `conversationId`, and `customer`. Filtering, grouping, and counts are computed in the page. The back-link origin travels as a `from` query param on the conversation URL.

## Risks / Open Questions

- The `from` param must be stripped when navigating between conversations in the inbox list, or the back link would go stale (handled in `buildHref`).
- "Both" (tabs + grouping) is more UI than a single approach; kept lean by reusing one `TaskCard` for both views.

## Portfolio Notes

Demonstrates completing a navigation loop (tasks → conversation → back) with correct context rather than a naive always-back, and an informed scope call: chose tabs + grouping together, kept maintainable by extracting a single shared card component.
