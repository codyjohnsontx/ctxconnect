# PRD: Portfolio Demo Dataset

> Historical record. Written before the product was renamed to **Attend** on
> 2026-08-03, and left with the name it used at the time. `CTX Chat` below means
> Attend. See [the rename decision](../decisions/2026-08-03-product-renamed-to-attend.md).

## Status

Built, with the seed's AI behavior superseded on 2026-08-02.

Two things below no longer describe the seed. `Seed deterministic AI Ops Brief
insights without calling OpenAI` and the `Do not call OpenAI during seed` non-goal
held until the seed gained a regeneration step: it still writes a hand-written
brief for every demo conversation, and then, when `OPENAI_API_KEY` is set,
regenerates those rows through the real model. The README's seed section owns that
behavior and its cost, and
[the event taxonomy](./2026-07-09-ai-ops-brief-event-taxonomy.md) owns what the
seeded events carry. The target user also moved to the service advisor, per
[the service advisor decision](../decisions/2026-08-02-service-advisor-is-the-primary-user.md).

## Date

2026-07-10

## Summary

Stock the seeded CTX Chat demo database with realistic dealership operations data, prebaked AI Ops Brief insights, and product analytics events so portfolio reviewers can understand the inbox and Command Center immediately.

## Problem

A fresh demo can look under-instrumented or inactive unless someone manually creates AI briefs and operational follow-ups first. Portfolio viewers need the product story to be visible immediately without setup work.

## Target User

Portfolio reviewers, hiring managers, PM interviewers, and technical product leaders viewing the app through the GM / operations owner workflow.

## Goal

Make a freshly seeded demo database feel like an active dealership operations workspace with realistic triage pressure, measurable AI usage, and clear safety constraints.

## v1 Scope

- Seed realistic customer conversations across Sales, Service, Parts, Finance, and General.
- Seed operational states including urgent lead, overdue approval, failed outbound message, unassigned request, pickup-ready customer, and SMS opt-out.
- Seed deterministic AI Ops Brief insights without calling OpenAI.
- Seed product analytics events for generated, accepted, dismissed, copied-reply, note-created, and follow-up-created AI actions.
- Seed AI-correlated note and follow-up task records.
- Make seeded customer child data idempotent across repeated seed runs.
- Update README seed documentation and PRD index.

## Non-Goals

- Do not call OpenAI during seed.
- Do not add new schema, API routes, app pages, or a public demo mode.
- Do not use real customer or business data.
- Do not add GA4, Looker, random data generation, or screenshot capture in this slice.

## Acceptance Criteria

- Given a fresh dev/demo database, when `pnpm prisma:seed` runs, then the app has realistic stocked demo data.
- Given the GM opens Inbox, when they inspect conversations, then multiple threads show realistic operational states.
- Given the GM opens Command Center, then AI Ops Analytics shows generated briefs, accepted/dismissed recommendations, high-risk insights, and note/follow-up usage.
- Given seed is run repeatedly, then seeded tasks, events, and opt-in and opt-out records do not duplicate.
- Given a customer is SMS opted out, then the seeded AI insight does not include a suggested SMS reply.

## Risks / Open Questions

- The seed targets local and demo databases only; operators must avoid running it against production.
- Seeded analytics are demonstration data, not real usage metrics.
- Manual QA is still needed to verify the final UI presentation after seeding.

## Portfolio Notes

This demonstrates product-system thinking: the demo is not only stocked with messages, but also with measurable AI workflow events, realistic operational pressure, and a compliance-aware opt-out example that shows AI as controlled decision support rather than automation for its own sake.
