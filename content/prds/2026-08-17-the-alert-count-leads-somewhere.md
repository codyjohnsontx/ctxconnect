# PRD: The Alert Count Leads Somewhere

## Status

Built

## Date

2026-08-17

## Summary

The alert rail counted one set of alerts and listed another. The badge said 5; the rail showed 3, with no way to reach the rest. The rail now lists every alert it counts, scrolls, and sends anything past its scan to a Command Center panel that reads deeper than it does.

## Problem

Two things made the number and the list describe different sets.

1. **They asked different questions.** The badge counted notifications with `status: UNREAD`. The list queried `status != RESOLVED`. Nothing in the app ever marks an alert read, which is the only reason those two sets happened to coincide - a latent divergence waiting for the first feature that moves an alert to READ.
2. **The list was capped below the count.** `getShellData` read five rows and the rail rendered the first three of those. The badge was unbounded. So the badge routinely named work the rail structurally could not show.

Measured on `main` for the seeded service advisor after the per-fact counting fix landed: badge **5**, rail **3**. Two alerts counted, listed nowhere, reachable by nothing on the screen.

The rail is also the advisor's only alert surface on this page, so "3 of 5" is not a summary - it is two pieces of work she has been told about and cannot open.

## Target User

The service advisor, who reads the rail to decide what to do next.

## Goal

Every alert the badge counts is either in the rail or one click away, and the rail says which.

## v1 Scope

- One clause - scope plus "not resolved" - answers both the badge and the list, in a database-free module both read.
- The rail lists every alert it was given and scrolls within the sidebar rather than truncating.
- The rail's heading is a link to a Command Center alerts panel, so the number always has a destination.
- Anything past the rail's scan gets an explicit "N more in Command Center" row rather than being dropped silently.
- The Command Center panel reads five times deeper than the rail, carries the same count, and says how many are beyond it.
- The unused `getNotificationSummary` is deleted. It was dead, and its scope clause handed a reader with no department the whole dealership's alerts.

## Non-Goals

- No marking alerts read, and no dismissing them from the rail. An alert stands until the work is done.
- No alert surface on mobile. The rail is `hidden lg:flex` and a phone user still reaches alerts only through Command Center; tracked separately.
- No paging beyond the Command Center's deeper scan.

## Acceptance Criteria

- Given a badge reading 5, when the advisor looks at the rail, then it lists 5 alerts.
- Given more alerts than the rail's scan reaches, when it renders, then the last row reads "N more in Command Center" and the numbers add up.
- Given she clicks the rail heading, when Command Center opens, then it lands on the Alerts panel.
- Given an alert marked READ, when the badge and the list are computed, then both include it.
- Given a reader with no department, when her scope is built, then she sees only the alerts addressed to her and not the whole dealership's.

## Risks / Open Questions

- The rail now grows with the alert count, so on a short viewport it scrolls inside the sidebar. That is deliberate: a scrollbar is a truthful affordance and a silent `slice(0, 3)` is not.
- Both surfaces are still bounded by a scan limit, and the Command Center's is finite too. The difference is that the gap is now stated on screen instead of invisible.
- `syncOperationalNotifications()` still only runs when somebody loads Command Center, so the rail can be stale. Separate defect; tracked.

## Portfolio Notes

This is the same underlying complaint as the per-fact counting fix - the count and the contents disagree - arriving from a different cause, and it is worth being precise about that. Counting facts instead of rows does not fix a list that was cut to three, and listing everything does not fix a count that triples. Each is independent; what they share is the answer, which is that one module should own the question so two surfaces cannot ask it differently.
