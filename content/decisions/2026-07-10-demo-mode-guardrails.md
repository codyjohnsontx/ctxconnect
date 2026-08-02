# Decision: Demo Mode Guardrails

## Date

2026-07-10

## Status

Accepted

## Context

We are adding a one-click "View demo" button so recruiters can enter the app without credentials. Discovery showed the login page already publishes the shared demo password, exposing two unthrottled paid surfaces: OpenAI ops-brief generation and real Twilio SMS sends. Demo data is also shared and mutable, so one visitor's mess becomes the next visitor's first impression. Four decisions shaped v1.

## Options Considered

**1. What can a demo session do with the paid/risky actions?**
1. AI live but capped; SMS blocked (chosen)
2. Everything simulated (canned briefs, fake sends)
3. Everything live, rate-limited only

**2. How do we keep the demo clean across visitors?**
1. Full write access + nightly scheduled reseed (chosen)
2. Read-only demo
3. Accept the mess for v1

**3. How much bot protection?**
1. Server-side caps only
2. Caps + Cloudflare Turnstile on the demo button (chosen)
3. Caps + per-IP rate limiting

**4. How do we designate the demo account?**
1. Env var `DEMO_USER_EMAIL` matched in the JWT callback (chosen)
2. `User.isDemoAccount` schema column + migration

## Decision

Demo sessions get live AI ops briefs capped at `DEMO_AI_DAILY_LIMIT` (default 20) per rolling 24h, hard-blocked SMS, and full write access to shared demo data restored by a nightly Vercel cron reseed. The demo button is gated by invisible Cloudflare Turnstile, the published credentials come off the login form, and the seeded password rotates via `SEED_PASSWORD`. The demo account is designated by env var, with `isDemo` derived by email match regardless of login path.

## Reasoning

- Live AI is the flagship feature — a canned demo undersells it, and the daily cap (a soft cap: the quota check is not atomic, so concurrent bursts can briefly exceed it) keeps expected spend to an **estimated** ~$0.40/day. (Estimate, not a measured figure: ~$0.02 per brief on `gpt-4.1-mini` at OpenAI's published pricing as of July 2026, assuming a few thousand input tokens and a few hundred output tokens per brief, × the 20-brief daily cap. Actual spend should be confirmed against the OpenAI usage dashboard after launch.) SMS is the opposite trade: highest blast radius (spam from a real number, compliance exposure) for minimal demo value.
- Superseded on 2026-08-02: `DEMO_AI_DAILY_LIMIT` no longer bounds the whole AI spend. The scheduled ambient pass and the seed's brief regeneration make model calls nobody clicked for, bounded instead by `AI_PASS_MAX_BRIEFS` and `SEED_AI_BRIEFS`. See the README's `The Ambient AI Pass` section and the [Ambient AI Brief Pass PRD](../prds/2026-08-02-ambient-ai-brief-pass.md).
- Full interactivity with nightly reseed gives the best recruiter experience at near-zero infra cost; the reseed doubles as cleanup for any bot mess.
- Turnstile is invisible to most humans, so it adds bot friction without recruiter friction; per-IP limiting would need new storage infrastructure for marginal benefit given the caps.
- Env-var designation avoids a schema migration for a single-account lookup, is per-environment, and is instantly revocable (unset = demo off). Email-match derivation means the old leaked password still lands inside the guardrails.

## Tradeoffs

- A determined abuser can still burn the capped AI budget daily (bounded to cents).
- Simultaneous visitors share state and see each other's actions.
- Turnstile adds a third-party dependency to the demo path (mitigated: fails open when unconfigured in dev, closed in prod).
- Demo-created customers with non-seeded phone numbers survive reseeds (accepted; logged as PRD open question).

## Portfolio Notes

Shows threat-model-driven scoping: converting "add a demo button" into a bounded-cost public demo by pricing each risk (AI ≈ cents, SMS ≈ compliance) and matching the guardrail to the risk rather than applying one blanket policy.
