# PRD: SVP Demo Readiness

## Status

Built

## Date

2026-07-22

## Summary

Make the public demo easier to understand in both a five-minute guided walkthrough and independent exploration by leading demo visitors into the Command Center and giving them a concise path to the human-in-the-loop AI workflow.

## Problem

The one-click demo currently drops a reviewer into a dense shared inbox. That proves operational depth, but a product leader exploring without guidance can miss the Command Center, AI analytics, experiment framing, and the path from operational signal to human-approved action.

## Target User

Product executives, hiring managers, and recruiters evaluating the product and Cody's product judgment, technical execution, and AI product thinking.

## Goal

Help a reviewer understand the product problem and reach the strongest product-thinking workflow within the first minute, while preserving normal staff sign-in behavior.

## v1 Scope

- Send one-click demo sign-ins to Command Center by default.
- Preserve an explicit callback URL when a reviewer follows a deep link.
- Add concise login copy that previews the recommended exploration path.
- Show demo-only orientation copy in Command Center: choose an operational signal, open a conversation, review the AI brief, and turn the recommendation into a human-approved action.
- Keep the orientation integrated into the page header rather than adding a tour modal or new navigation system.

## Non-Goals

- Notification triage.
- New analytics, AI behavior, or operational workflows.
- Schema or seed-data changes.
- A broad visual redesign.
- Claims of measured business impact or a live experiment.

## Acceptance Criteria

- Given a visitor selects `View demo` without a callback URL, when authentication succeeds, then they land on `/command-center`.
- Given a demo visitor follows a protected deep link, when authentication succeeds, then the explicit callback URL is preserved.
- Given a regular staff user signs in without a callback URL, when authentication succeeds, then they continue to land on `/inbox`.
- Given a demo user opens Command Center, when the page renders, then a concise recommended path explains how to reach the AI-assisted workflow.
- Given a non-demo user opens Command Center, when the page renders, then the demo orientation is not shown.
- Given the login page renders with demo mode enabled, when a reviewer reads the demo helper copy, then it names Command Center and the flagged-conversation AI workflow.

## Risks / Open Questions

- Command Center is information-dense; the orientation must stay compact and should not compete with operational metrics.
- Some reviewers may expect an inbox-first messaging product. The login page and Command Center path must make the relationship between operational signals and conversations explicit.
- No live usage metrics yet. The intended success signal is whether a reviewer can find and explain the AI workflow without coaching.

## Presenter Runbook

### Five-minute core

1. Frame the problem: dealership customer communication is fragmented across messages, follow-ups, service context, and ownership.
2. Open Command Center: show how operational signals prioritize what needs attention rather than creating another passive dashboard.
3. Open one high-risk AI insight: show the original conversation and customer context.
4. Review AI Ops Brief: emphasize structured decision support, human approval, and the suggested next action.
5. Close with evidence of product judgment: event instrumentation, SMS safety guardrails, AI spend controls, and an honest `Not running` experiment state.

### Optional depth to fifteen minutes

- Explain the seeded portfolio dataset and why it avoids invented outcomes.
- Show how an AI recommendation becomes a follow-up or internal note.
- Show Tasks as the operational system of record for follow-through.
- Discuss the one-click demo threat model: real AI is capped, real SMS is blocked, bot protection is enabled, and demo data is reseeded.
- Discuss what was intentionally excluded: autonomous AI actions, premature A/B testing, and notification triage before user evidence.

## Portfolio Notes

This slice demonstrates audience-aware product presentation: the underlying workflow stays unchanged, but the demo entry point and orientation are aligned to the decision-maker's evaluation needs. The product decision favors a short path to operational prioritization, human-in-the-loop AI, measurable behavior, and explicit guardrails over adding another feature before the meeting.
