# PRD: Ambient AI Brief Pass and Ranked Advisor Queue

## Status

Built

## Date

2026-08-02

## Owner

Cody Johnson

## Summary

CTX Chat's pitch is "it reads every conversation a service advisor has and tells her
what to do next." Until now the AI read one conversation, when a human clicked a
button on it. This makes the first half of that sentence true: a background pass
briefs every conversation that has new activity, and the advisor's inbox is ordered
by what the AI flagged instead of by recency.

## Problem

A service advisor opens the app to a list of threads in message order. To find out
which of them is about to go wrong she has to open each one and click Generate
brief. The product knows how to assess a conversation, but only on request, one at a
time - so the work of triage stays with her, which is the work the product claims to
remove.

## Target User

The service advisor. Alyssa Torres in the demo data: SERVICE role, SERVICE
department, owns the service lane's customer threads.

## Goal

The advisor opens the inbox and the top of the list is already the right answer:
these are the threads that need you today, and here is why.

## Background

The inference path (`src/lib/ai/ops-brief.ts`) was already real - strict structured
output against a 12-field schema, re-validated with Zod, with a compliance override
that suppresses a suggested SMS reply for opted-out customers. The accept / dismiss /
convert-to-task loop was already built and instrumented. What did not exist was
anything that ran the model without a person asking, and anything that used the
model's output to order the queue. The schema already carried every field a ranking
needs: `riskLevel`, `escalationRecommended`, `confidence`, `dismissedAt`.

## v1 Scope

- A pass that briefs every eligible conversation, invoked on a schedule and on demand.
- Eligibility that is cheap and explainable: still open, has at least one inbound
  customer message, and has no brief newer than its last activity.
- An inbox ordered by the AI's output, with the reason shown on the row.
- Honest degradation: no key or a failing provider leaves threads unbriefed and says
  so, and never writes a brief.

## Non-Goals

- Streaming or real-time briefing on message arrival. The pass is scheduled.
- Briefing closed conversations, or threads where no customer has said anything.
- Any change to how a brief is generated, validated, or accepted.
- Cross-department triage for managers. The queue is the advisor's.

## User Flow

1. Overnight, the scheduled pass briefs every conversation with new activity.
2. Alyssa opens `/inbox`. The queue is ordered: escalations first, then by risk.
3. Each row shows a risk badge and the single next action the model recommends.
4. She opens the top thread and gets the full brief, with accept / dismiss / copy
   reply / convert to note or follow-up unchanged.
5. If she wants the queue re-evaluated mid-shift, `Run pass` does it in place and
   reports what it did.

## Requirements

- The pass reuses `generateAiOpsBrief` unchanged. No second prompt, no second schema.
- A conversation is never re-briefed while nothing has changed in it.
- Every pass is bounded by `AI_PASS_MAX_BRIEFS` (default 12) so one run cannot spend
  unbounded money.
- The on-demand pass is scoped to conversations the caller can already see, and for
  the shared demo account it is additionally capped by the remaining daily quota.
- The scheduled route is authorized by `CRON_SECRET`, the same contract as the
  demo reseed route.

## Acceptance Criteria

- Given a conversation with an inbound message and no brief, when the pass runs,
  then a brief is written and the conversation is ranked by it.
- Given a conversation whose brief is newer than its last message, when the pass
  runs, then no model call is made for it.
- Given a conversation with no inbound customer message, when the pass runs, then it
  is skipped.
- Given `OPENAI_API_KEY` is unset, when the inbox renders, then it says AI is not
  configured, no brief is written, and the failure is recorded.
- Given an invalid `OPENAI_API_KEY`, when the pass runs, then every attempt is
  recorded as `AI_INSIGHT_FAILED` with reason `provider_failure` and no brief row is
  created.
- Given two briefed conversations, when one recommends escalation, then it sorts
  above the other regardless of message recency.
- Given a brief the advisor dismissed, then that conversation stops carrying its AI
  risk and falls back to the priority staff set on it, so dismissing the AI's opinion
  never erases the human's.

## Edge Cases

- **No key**: banner instead of the run control; nothing briefed; nothing fabricated.
- **Provider failure**: the run reports "the AI pass failed on N conversations.
  No briefs were written."
- **Nothing eligible**: the run says so rather than looking like it worked.
- **Demo quota exhausted**: the on-demand pass stops before spending anything and
  names the quota, matching the 429 that guards the per-conversation button.
- **Unbriefed thread**: sorts as NORMAL, not as safe. An unknown is not a low risk.

## Data Requirements

No schema change. Reads `Conversation`, `Message`, `Task`, `Customer`. Writes
`ConversationAiInsight` and `ProductEvent` rows exactly as the existing button does,
with `source: "ambient_pass"` in the event metadata and a null `requestedByUserId`
when no human asked.

## Analytics / Success Metrics

No real usage metrics - there are no live users.

Expected outcome: the advisor stops opening threads to find out whether they matter.

Signals to track once there is traffic:

- Share of conversations carrying a brief newer than their last message.
- Acceptance rate of briefs produced by the pass versus briefs produced on request.
- Position in the queue of the conversation the advisor actually opens first. If the
  ranking is right, it trends toward the top.

## Risks

- **Cost.** Every brief is a paid call. Mitigated by the staleness rule, the per-run
  ceiling, and the demo quota - but a busy dealership with 500 threads a day would
  need a real budget conversation before this ships.
- **Ranking trust.** If the model over-rates routine threads, the queue becomes
  noise and the advisor goes back to reading everything. Falling a dismissed brief
  back to the staff priority is the first defense; a confidence floor is the obvious
  next one.
- **Latency.** A pass over many conversations is sequential and slow. Acceptable for
  a nightly job; it would need batching before it could run per-message.

## Open Questions

- Should the pass run on inbound message arrival instead of on a schedule? That is
  the honest end state, and it is a cost decision more than a technical one.
- Should confidence below some threshold suppress the ranking contribution?

## Implementation Notes

- `src/lib/ai/brief-runner.ts` - one place that loads conversation context, calls the
  model, writes the insight, and records the events. The API route and the pass both
  use it.
- `src/lib/ai/ambient-pass.ts` - eligibility, bounding, and the loop.
- `src/lib/ai/queue-rank.ts` - the ordering, isolated so it is readable on its own.
- `src/app/api/ai/sweep/route.ts` - the scheduled entry point.

## Portfolio Notes

The product decision worth talking about is the eligibility rule. "Reads every
conversation" is a sentence that costs money on every run, so the interesting design
question is not how to call the model - it is how to *not* call it. Briefing only
threads with new activity since their last brief makes the claim true, keeps a
re-run nearly free, and is one sentence a non-technical listener understands.

The second decision is ranking an unbriefed thread as NORMAL rather than LOW. An
unknown is not a safe bet, and burying threads the system has not looked at would
quietly break the promise the queue makes.
