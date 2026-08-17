# PRD: One Alert Per Thing That Needs Doing

## Status

Built

## Date

2026-08-17

## Summary

Attend's alert rail counted the rows it stores rather than the work they describe. One overdue follow-up is stored once per manager plus once for its assignee, so the service advisor's badge said 15 where she had 5 things to do, and the rail listed the same follow-up twice in three visible rows. The Command Center made the matching error in the other direction, reporting fewer overdue follow-ups than the overdue alerts printed beneath it.

## Problem

**Alerts are stored per recipient; work is not.** `notifyManagers` writes one `Notification` row per active manager, and `notifyAssignee` adds another for a follow-up's owner. Any reader whose scope spans more than one recipient reads the same fact several times: an advisor sees every row tagged with her department, and a manager's scope is the whole dealership.

Measured against `main` for the seeded service advisor: badge **15**, distinct facts **5**. A 3x overstatement of her own workload, on the number she uses to decide whether she is behind.

Two smaller versions of the same error rode along:

- **A follow-up read as both still coming and already late.** The sweep raises `FOLLOW_UP_OVERDUE` when the clock passes the due date but never withdrew the `FOLLOW_UP_DUE` row it supersedes, so both stood.
- **The Command Center's overdue tile split the day at midnight while every other surface split it at the current time.** Reproduced: the tile read "1 Overdue follow-ups" on the same screen as two distinct overdue follow-up alerts. A follow-up that fell due earlier today was late in the rail and not-yet-due on the tile - which is most of a working day.

## Target User

The service advisor reading her badge to decide whether she is behind, and the manager reading the Command Center tiles.

## Goal

An alert is counted and listed once per real thing that needs doing, wherever it is shown.

## v1 Scope

- One rule, in a database-free module, for collapsing alert rows to facts: same subject, same conversation, task and message is one alert.
- The rail badge, the Command Center panel, the SLA focus list and the Command Center's SLA tile all count facts.
- A follow-up that has crossed its due date withdraws the "due today" row it supersedes, and the other way round when it is moved.
- The overdue and due-today tiles split today's queue at the current time, the rule every other surface already used.
- Where more than one row describes a fact, the row shown is the one describing its current state, preferring the copy addressed to the reader.

## Non-Goals

- No change to how alerts are stored. Per-recipient rows are how an alert becomes readable, resolvable and addressable per person; this is a read-time rule.
- No change to which alerts are raised, or to the SLA windows.
- The rail still lists fewer alerts than it counts. That is a separate defect and it is fixed next.

## Acceptance Criteria

- Given three stored copies of one overdue follow-up, when the advisor reads her rail, then the badge counts it once and the rail lists it once.
- Given a follow-up that has crossed its due date, when the sweep next runs, then it reads as overdue only.
- Given two distinct overdue follow-ups, when the Command Center renders, then the overdue tile reads 2.
- Given a follow-up due later today, when the Command Center renders, then it counts under due-today and not under overdue.

## Risks / Open Questions

- Counting facts is a `groupBy` rather than a `count`, which is one query either way but a more expensive one. It is bounded by the alert table, not the message table.
- Lists read `notificationScanLimit` rows before collapsing, because the copies of one fact sort next to each other and would otherwise fill a short list. That is a scan bound, not a display bound, and anything beyond it is unlisted - which is what the next PRD addresses.

## Portfolio Notes

The interesting part is that the badge was not wrong by a bug; it was answering a different question than the one the advisor was asking. "How many alert rows match you" and "how many things do you have to do" only coincide when each fact reaches exactly one person. The fix is a definition, not a patch, which is why it belongs in one module every surface reads.
