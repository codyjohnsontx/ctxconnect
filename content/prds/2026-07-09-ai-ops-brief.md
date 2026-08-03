# PRD: AI Ops Brief

## Status

Built, with the target user superseded on 2026-08-02.

**Read the rest of this document as a historical record of the 2026-07-09 slice.**
Everywhere below that says the GM, it meant the GM at the time. The primary user is
now the service advisor, per
[the service advisor decision](../decisions/2026-08-02-service-advisor-is-the-primary-user.md),
and the same brief now serves her in `/inbox`.

Specifically superseded:

- **Target user, goal, user flow, user stories, acceptance criteria**: written for
  the GM. The mechanism they describe is unchanged; only the person is.
- **Click-only generation**: briefs are no longer produced only by a click. See
  [Ambient AI Brief Pass and Ranked Advisor Queue](./2026-08-02-ambient-ai-brief-pass.md).
- **The Command Center experiment-readiness panel**: removed from the UI, so the
  acceptance criterion that asserts it no longer holds. Its content is now owned by
  [docs/experiment-plan.md](../../docs/experiment-plan.md).

Still accurate: the AI contract, the structured output and validation, the product
event taxonomy, and the AI Ops Analytics panel on Command Center.

## Date

2026-07-09

## Owner

Cody Johnson

## Summary

AI Ops Brief adds an OpenAI-powered assistant inside the selected inbox conversation so the GM can quickly understand thread summary, customer need, risk, escalation recommendation, next action, suggested reply, and follow-up. The workflow also records product analytics events and surfaces adoption/outcome metrics in Command Center.

## Problem

Customer messaging threads contain operational signals spread across messages, failed sends, follow-ups, priority, and ownership. The GM needs to decide which conversations need attention and what action should happen next without manually reconstructing every thread.

## Target User

GM / operations owner.

## Goal

Reduce triage effort while keeping the GM in control of customer-facing and internal actions.

## Background

The app already centralizes dealership messaging, follow-ups, failed messages, notifications, and Command Center operations metrics. AI Ops Brief applies AI as decision support and instruments whether operators generate, accept, dismiss, copy, or convert suggestions into internal actions.

## v1 Scope

- Generate structured AI insights inside the selected inbox conversation panel.
- Persist generated AI insights.
- Track AI workflow events.
- Show AI Ops Analytics in Command Center.
- Show an experiment-readiness panel for future AI-suggested reply testing.
- Add event taxonomy documentation.

## Non-Goals

- Full A/B testing randomization.
- GA4 or Looker integration.
- Multi-provider AI abstraction.
- Autonomous AI actions.
- AI-sent messages.
- AI changing assignments, priorities, conversation status, or task status.
- Customer-facing AI disclosure flows.
- Compliance-grade audit export.

## User Flow

1. GM opens an inbox conversation.
2. GM clicks `Generate brief`.
3. App records `AI_INSIGHT_REQUESTED`.
4. If OpenAI is configured, the app generates and saves a structured insight.
5. App records `AI_INSIGHT_GENERATED` or `AI_INSIGHT_FAILED`.
6. GM reviews the brief and may accept, dismiss, copy reply, draft an internal note, or draft a follow-up.
7. Command Center displays AI workflow metrics and latest high-risk AI insights.

## Requirements

- Use OpenAI structured outputs for predictable fields.
- Return `503` when `OPENAI_API_KEY` is missing.
- Never mutate conversation status, assignments, messages, or tasks during generation.
- Do not recommend SMS outreach when the customer is opted out.
- Keep actions human-approved.
- Scope analytics to the current user's conversation access.

## User Stories

- As a GM, I want an AI-generated operational summary so I can understand a thread quickly.
- As a GM, I want risk and escalation signals so I can prioritize attention.
- As a GM, I want suggested next actions and drafts so I can move faster without losing control.
- As a product owner, I want event tracking so I can evaluate whether AI suggestions are useful.

## Acceptance Criteria

- Given a GM opens a conversation, when they click `Generate brief`, then the app creates a real AI-generated structured insight for that conversation.
- Given the AI provider succeeds, when the response returns, then the UI shows summary, customer need, risk, escalation, next action, suggested reply, and suggested follow-up fields.
- Given the AI provider fails, when the request completes, then the UI shows a clear error state and does not alter the conversation.
- Given `OPENAI_API_KEY` is missing, when the GM tries to generate a brief, then the UI shows AI is not configured and the API returns `503`.
- Given a customer is opted out, when the AI generates a recommendation, then it must not recommend sending an SMS reply.
- Given the GM accepts or dismisses a recommendation, when the action is submitted, then a product analytics event is stored.
- Given AI events exist, when the GM opens Command Center, then the AI Ops Analytics panel displays counts and acceptance rate.
- Given no AI events exist, when the GM opens Command Center, then the analytics panel renders an empty state without errors.
- Given the GM opens Command Center, when they view Experiment Readiness, then they see hypothesis, primary metric, guardrail metric, test idea, and status.
- The experiment panel must not imply a live experiment is running.

## Edge Cases

- Conversation has no messages.
- Conversation has only internal notes.
- Conversation contains failed outbound messages.
- Conversation customer is SMS opted out.
- Conversation has overdue tasks.
- AI returns invalid or incomplete structured output.
- AI provider times out.
- User lacks access to the conversation.
- User double-clicks generate.
- Existing insight exists for the thread.
- Database write succeeds but AI call fails.
- AI call succeeds but insight persistence fails.

## Data Requirements

- Create `ConversationAiInsight`.
- Create `ProductEvent`.
- Add `AiInsightActionType` and `ProductEventType`.
- Read conversation, customer, messages, tasks, assigned user, tags, dealership settings, and current session user.
- Do not update conversation, assignment, priority, messages, or tasks during generation.

## Analytics / Success Metrics

No real usage metrics yet.

Expected outcome: GMs can triage messaging threads faster with clearer operational next actions.

Metrics to track after launch:

- AI briefs generated.
- Recommendation acceptance rate.
- Recommendation dismissals.
- Suggested replies copied.
- Follow-up/note actions from AI suggestions.
- Latest high-risk AI insights.
- Future metric: response time after AI brief generation.

## Risks

- AI may summarize incorrectly or overstate urgency.
- Operators may treat AI suggestions as authoritative.
- Missing API key or provider outage can create a dead-end state if not messaged clearly.
- Event names such as follow-up/note creation can overstate action completion if v1 only prefills existing forms.
- Structured output schema changes can break generation if not validated.

## Open Questions

- Should future versions distinguish `prefilled` from `created` product events?
- Should accepted AI suggestions become part of a formal audit trail?
- Should AI response quality be reviewed manually before expanding automation?

## Tickets

1. Add Prisma models, enums, migration, and generated client.
2. Add OpenAI structured-output generation helper.
3. Add generate and action API routes.
4. Add AI Ops Brief inbox component.
5. Add AI Ops Analytics and Experiment Readiness to Command Center.
6. Add event taxonomy documentation.
7. Validate lint, type check, build, Prisma generation, and migration.

## Implementation Notes

- Use `OPENAI_MODEL` with `gpt-4.1-mini` fallback.
- Use official OpenAI JavaScript SDK.
- Use strict structured outputs and Zod validation.
- Return `502` for provider failure and `503` for missing AI configuration.
- Store analytics internally in `ProductEvent`.

## Portfolio Notes

This feature demonstrates AI as operational decision support, not decoration. The PM story is that the workflow turns messy dealership messaging into structured decisions, human-approved actions, observable events, and experiment-ready metrics without prematurely building a full experimentation platform.
