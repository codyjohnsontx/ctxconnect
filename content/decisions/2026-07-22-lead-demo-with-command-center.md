# Decision: Lead the Public Demo with Command Center

## Date

2026-07-22

## Status

Reversed on 2026-08-02 by
[The service advisor is the primary user](./2026-08-02-service-advisor-is-the-primary-user.md).
The one-click demo now signs in as the service advisor and lands on `/inbox`, and the
Command Center orientation copy was removed.

## Context

The public demo must work as both a guided five-to-fifteen-minute walkthrough and an independent review by a product executive. The existing one-click flow lands in Inbox, where operational depth is visible but the strongest product judgment, AI analytics, and experiment framing are easier to miss.

## Options Considered

1. Keep Inbox as the default and rely on the presenter to navigate.
2. Send demo visitors to Command Center and provide a concise recommended path.
3. Build a multi-step product tour or demo-only walkthrough overlay.

## Decision

Send one-click demo visitors to Command Center by default and show compact demo-only orientation copy there. Preserve explicit deep-link callbacks and keep regular staff sign-in behavior unchanged.

## Reasoning

Command Center exposes the product's decision layer immediately: operational signals, AI workflow analytics, experiment readiness, and links into the underlying customer conversations. A concise path also supports self-serve review without adding a new tour system the day before the meeting.

## Tradeoffs

- Reviewers do not begin on the most familiar messaging surface.
- Command Center is denser than Inbox and needs clear orientation.
- A lightweight prompt provides less hand-holding than a full tour, but carries much lower implementation and regression risk.

## Portfolio Notes

This decision shows audience prioritization and scope control: optimize the first minute for a product decision-maker while preserving the real operational workflow and avoiding a rushed presentation-only subsystem.
