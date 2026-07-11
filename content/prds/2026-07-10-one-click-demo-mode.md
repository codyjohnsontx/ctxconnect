# PRD: One-Click Demo Mode with Abuse Guardrails

## Status

Built

## Date

2026-07-10

## Owner

Cody Johnson

## Summary

Add a one-click "View demo" button to the login screen so recruiters and interested visitors can explore the app without typing credentials, while simultaneously closing the abuse surface that shared demo credentials create: cap paid AI calls, block real SMS sends for demo sessions, add bot protection, and restore pristine demo data nightly.

## Problem

Two problems, one feature:

1. **Friction for the audience that matters.** Recruiters and portfolio reviewers hit a credentials form before seeing anything. Even with pre-filled fields, it is an extra decision point and an unclear invitation.
2. **The current "demo access" is an open abuse surface.** The login form pre-fills and publicly prints the shared password (`ctxdemo123`) for all five seeded accounts. Anyone — including bots and scrapers — can log in and hit two unthrottled cost surfaces: `POST /api/ai/ops-brief` (paid OpenAI call, no rate limiting anywhere in the repo) and `POST /api/messages/send` (real SMS from the connected Twilio number).

## Target User

- Primary: recruiters and hiring managers evaluating Cody's portfolio work.
- Secondary: anyone interested in the product who lands on the login page.
- Anti-user to defend against: bots/scrapers/abusers who would burn OpenAI spend or send spam SMS.

## Goal

A visitor reaches a fully working inbox in one click, sees the flagship AI feature working live, and cannot cost the owner meaningful money or send real SMS — and the next visitor always finds the demo in a clean state.

## Background

- Auth: NextAuth v4 credentials provider, JWT sessions (`src/lib/auth.ts`).
- The seeded `gm@ctxchat.local` (MANAGER) sees all 9 conversations, tasks, customers, and command center — the best showcase account.
- AI ops briefs cost ~$0.02 each on `gpt-4.1-mini`; each is a user-triggered click in the inbox.
- SMS sends go through the real Twilio account — cost plus compliance/spam risk.
- Demo data is shared and mutable: one visitor's mess is the next visitor's first impression.

## v1 Scope

1. "View demo" button on the login page that signs into the designated demo account with no password entry. The account is set by the required `DEMO_USER_EMAIL` env var (typically `gm@ctxchat.local`); there is no built-in default — leaving it unset disables demo mode entirely.
2. Server-derived `isDemo` session flag (email match in the JWT callback, regardless of which login path was used).
3. SMS sending hard-blocked server-side for demo sessions, with a clear composer notice.
4. AI ops-brief generation live for demo sessions but capped per rolling 24h (`DEMO_AI_DAILY_LIMIT`, default 20), enforced server-side via existing `ProductEvent` counts; friendly 429 message in the UI.
5. Cloudflare Turnstile (invisible CAPTCHA) gating the demo button; server-side token verification.
6. Remove the pre-filled/printed credentials from the login form; rotate the seeded password via `SEED_PASSWORD` env.
7. Nightly reseed via Vercel cron → `GET /api/demo/reseed` (CRON_SECRET-guarded) restoring pristine demo data.

## Non-Goals

- No per-visitor isolated demo sandboxes (all demo visitors share the seeded dataset).
- No rate limiting for regular (non-demo) staff accounts.
- No IP-based rate limiting or tracking infrastructure.
- No simulated/canned SMS-send experience — sending is simply disabled in demo.
- No cleanup of demo-created customers with non-seeded phone numbers (see Open Questions).

## User Flow

1. Visitor lands on `/login`. No credentials are displayed anywhere.
2. Visitor clicks "View demo". Turnstile has (usually invisibly) issued a token; the button is enabled once the token exists.
3. Visitor lands in `/inbox` as the GM demo user with full visibility of seeded conversations, tasks, and the command center.
4. Visitor generates AI ops briefs — real OpenAI calls, up to the daily cap. At the cap, an amber notice explains the demo limit.
5. Visitor opens the composer — it is disabled with a note: demo mode has outbound SMS turned off; everything else is live.
6. Overnight, a cron reseed restores pristine data for the next visitor.

## Requirements

- Demo sign-in must not transmit or expose any password.
- `isDemo` must be derived from the account (email match with `DEMO_USER_EMAIL`), not the login path, so legacy-password logins to the demo account are equally guarded.
- SMS block must run before any `Message` row is created (no junk FAILED rows).
- AI cap must be enforced before the OpenAI call and before the `AI_INSIGHT_REQUESTED` event insert.
- Turnstile must fail open when keys are unset (local dev) and fail closed when configured.
- With `DEMO_USER_EMAIL` unset, the demo button is hidden and the demo provider rejects — feature cleanly off.
- Reseed endpoint must reject requests without the correct `Authorization: Bearer ${CRON_SECRET}` header, including when the secret is unset.
- `npm run prisma:seed` CLI behavior must be unchanged.

## User Stories

- As a recruiter, I want to open a working demo in one click, so that I can evaluate the product without friction.
- As the app owner, I want demo sessions to be unable to send SMS or exceed a small AI budget, so that public demo access cannot cost me meaningful money or send spam.
- As the app owner, I want demo data restored nightly, so that every visitor gets a clean first impression.

## Acceptance Criteria

- Given the login page with `DEMO_USER_EMAIL` set, when a visitor clicks "View demo" (and Turnstile verification passes when configured), then they land in `/inbox` signed in as the demo user without entering credentials.
- Given the login page, when it renders, then no email, password, or account list is pre-filled or displayed.
- Given a demo session, when the user attempts `POST /api/messages/send`, then the server returns 403 before creating any Message row, and the composer UI is disabled with an explanatory note.
- Given a demo session at the daily AI limit, when the user requests another ops brief, then the server returns 429 with a friendly message before calling OpenAI, and the UI shows it as an informational (amber) notice.
- Given a demo session under the limit, when the user requests an ops brief, then a real OpenAI-generated brief is returned.
- Given a non-demo (admin/staff) session, when using SMS send or AI briefs, then behavior is unchanged.
- Given `TURNSTILE_SECRET_KEY` set and an invalid/expired/replayed token, when demo sign-in is attempted, then it fails with a retryable error and the widget resets.
- Given `DEMO_USER_EMAIL` unset, when the login page renders, then no demo button appears and `signIn("demo")` fails.
- Given the reseed endpoint, when called without the correct bearer secret, then it returns 401; with the correct secret, demo conversations/tasks/insights are restored to the seeded state.

## Edge Cases

- Turnstile token failure/expiry → sign-in fails with "Verification failed — please try again"; widget resets (tokens are single-use).
- Turnstile keys unset (local dev) → no widget rendered, server verification skipped with a warning; demo flow fully works.
- Demo user deactivated (`active: false`) → demo provider rejects; button may still render but sign-in fails safely.
- Cap exceeded → 429 with friendly copy; resets via rolling 24h window (reseed also cascade-deletes demo ProductEvents, effectively resetting daily).
- Reseed while a demo user is mid-session → JWT survives (user IDs stable via upsert), but conversation/task IDs rotate; a parked user gets a 404 until navigating back to `/inbox`. Acceptable at ~3 AM.
- Old published password (`ctxdemo123`) still works until `SEED_PASSWORD` rotation is applied in production — but such logins are still flagged `isDemo` by email match, so all guardrails hold in the window.

## Data Requirements

- Read: `ProductEvent` count (`AI_INSIGHT_REQUESTED`, demo `userId`, rolling 24h) for cap enforcement.
- Created: `AI_INSIGHT_FAILED` ProductEvent with `metadata.reason = "demo_cap"` when the cap blocks a request.
- No schema changes or migrations.
- Reseed: destructive-recreate of seeded customers' conversations/messages/tasks/insights (existing seed behavior), stable user IDs.

## Analytics / Success Metrics

No live usage metrics yet.

- Expected outcome: a recruiter reaches a working inbox in one click with zero credential handling.
- Signals to track after launch: demo sign-ins (NextAuth logs / Vercel analytics), `AI_INSIGHT_FAILED` events with `reason: "demo_cap"` (indicates cap pressure or abuse), OpenAI daily spend staying near the cap ceiling (estimated ~$0.40/day at 20 briefs × ~$0.02). Note this is a **soft cap**: the quota count and request-event insert are not atomic, so a burst of concurrent requests can briefly exceed the limit by a few briefs.
- Portfolio-safe claim: "Designed demo mode balancing recruiter experience against abuse of paid API surfaces; a soft daily cap keeps expected OpenAI spend to an estimated ~$0.40/day."

## Risks

- Shared demo state means simultaneous visitors see each other's actions; accepted for v1.
- Reseed relies on Vercel cron + `CRON_SECRET` being configured; if unconfigured, data drifts until manual reseed.
- Turnstile adds a third-party dependency to the demo path; mitigated by fail-open-when-unconfigured design (dev) and fail-closed in prod.
- Neon pooled connection could struggle with the reseed's long query sequence; fallback is a `DIRECT_URL` client in the route.

## Open Questions

- Should demo-created customers (non-seeded phone numbers) be cleaned up during reseed? v1 accepts they persist; optional extension: delete customers whose phone is not in the seeded list.
- Is 20 briefs/day the right cap? Env-tunable (`DEMO_AI_DAILY_LIMIT`) so it can be adjusted without a deploy.

## Tickets

1. Demo provider + View-demo button + credential removal + password rotation (`src/lib/auth.ts`, `src/types/next-auth.d.ts`, `src/components/login-form.tsx`, `src/app/(auth)/login/page.tsx`, `prisma/seed.ts`, `.env.example`).
2. SMS block + AI cap (`src/app/api/messages/send/route.ts`, `src/app/api/ai/ops-brief/route.ts`, `src/components/message-composer.tsx`, `src/components/inbox-view.tsx`, inbox pages, `src/components/ai-ops-brief.tsx`).
3. Turnstile (`src/lib/turnstile.ts`, `src/lib/auth.ts`, login form/page).
4. Nightly reseed cron (`src/lib/demo-seed.ts`, `prisma/seed.ts`, `src/app/api/demo/reseed/route.ts`, `vercel.json`).

## Implementation Notes

- `isDemo` flows: JWT callback email match → session callback → server-component props (no SessionProvider in this app).
- AI cap reuses the existing `ProductEvent` table and its `@@index([type, createdAt])` — no new rate-limiting infrastructure.
- New env vars: `DEMO_USER_EMAIL`, `DEMO_AI_DAILY_LIMIT`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CRON_SECRET`, `SEED_PASSWORD`.
- Deployment follow-ups: set env vars in Vercel, create the Turnstile widget in the Cloudflare dashboard, set a random `SEED_PASSWORD`, trigger one reseed to rotate the password.

## Portfolio Notes

This feature demonstrates threat-model-driven product scoping: the ask was "a demo button," but discovery showed the login page already published credentials against two unmetered paid APIs. The product decisions — live-but-capped AI (keep the flagship feature real), hard-blocked SMS (highest blast radius, lowest demo value), full write access with nightly reseed (best recruiter experience at near-zero infra cost), and invisible CAPTCHA over IP infrastructure (friction vs. dependency tradeoff) — each traded demo fidelity against a bounded expected cost. Screenshots to capture after build: login page with demo button, SMS-blocked composer note, AI cap notice.
