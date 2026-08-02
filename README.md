# CTX Chat

CTX Chat reads every conversation a service advisor has and tells her what to do next.

It is an internal staff workspace for one motorcycle dealership: a shared SMS inbox
ranked by an AI pass that briefs each thread and flags the ones that need a human.
The primary user is the **service advisor**. There is no public or customer-facing
website in this app - every route except `/login`, `/privacy-policy`, and
`/terms-and-conditions` requires a staff session.

The ninety-second demo path is in [docs/demo-script.md](docs/demo-script.md). The
product decisions behind the current framing are in
[content/decisions/2026-08-02-service-advisor-is-the-primary-user.md](content/decisions/2026-08-02-service-advisor-is-the-primary-user.md).

## Screenshots

Screens below show the local demo UI.

| Login | Inbox | Tasks |
| --- | --- | --- |
| ![CTX Chat login screen](public/screenshots/login.png) | ![CTX Chat inbox and conversation view](public/screenshots/inbox.png) | ![CTX Chat follow-up task queue](public/screenshots/tasks.png) |

## Stack

- `Next.js` App Router
- `TypeScript`
- `Tailwind CSS`
- `Prisma 7`
- `Neon Postgres`
- `Auth.js` credentials login
- `Twilio` SMS/MMS route structure
- `Vercel` for local/preview/production deployment targets

## Environment Contract

`DATABASE_URL` is always the Neon pooled runtime URL used by the app at runtime.

`DIRECT_URL` is always the Neon direct connection used by Prisma CLI commands and one-time admin scripts.

Required app env:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_APP_URL`

Required CLI/bootstrap env:

- `DIRECT_URL`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Twilio env:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`

AI env:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` defaults to `gpt-4.1-mini` when unset
- `AI_PASS_MAX_BRIEFS` caps how many conversations one ambient pass will brief, defaults to `12`
- `SEED_AI_BRIEFS` set to `false` to stop the seed regenerating its briefs through the real model

Demo and cron env:

- `DEMO_USER_EMAIL` names the demo account, see `Demo Mode`
- `DEMO_AI_DAILY_LIMIT` caps how many briefs the demo account can generate per rolling 24h, defaults to `20`
- `CRON_SECRET` authorizes the scheduled `GET /api/demo/reseed` and `GET /api/ai/sweep` routes
- `SEED_PASSWORD` is required before demo data can be seeded in production
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` gate the `View demo` button; without the secret, verification is skipped outside production and refused in production

## Local Setup

1. Copy `.env.example` to `.env`.
2. Point `DATABASE_URL` at the Neon non-production `dev` branch pooled URL.
3. Point `DIRECT_URL` at the matching Neon non-production `dev` branch direct URL.
4. Generate the Prisma client:

```bash
pnpm prisma:generate
```

1. Apply local development migrations:

```bash
pnpm prisma:migrate
```

1. Seed local demo data:

```bash
pnpm prisma:seed
```

1. Start the app:

```bash
pnpm dev
```

## Seeded Local Logins

`prisma/seed.ts` is for local development only. All seeded users use password `ctxdemo123`.

- `admin@ctxchat.local`
- `gm@ctxchat.local`
- `sales@ctxchat.local`
- `service@ctxchat.local`
- `parts@ctxchat.local`

The local seed creates a portfolio-ready demo state with staff users, demo customers, conversations, tasks, notifications, tags, templates, AI Ops Brief insights, and product analytics events. Do not use it for production initialization.

The seed uses fictional customer data. It always writes a hand-written fallback
brief for each demo conversation so the app is never empty and never depends on a
provider being up.

When `OPENAI_API_KEY` is set, the seed then regenerates those same briefs through
the real inference path, so a viewer sees genuine model output rather than text
someone typed. A conversation whose call fails keeps its written fallback, which is
why the demo cannot break on a provider outage. Each regenerated brief is a paid
call; set `SEED_AI_BRIEFS=false` to skip that step and keep the written text.

## The Ambient AI Pass

The AI ops brief does not wait to be asked. A background pass briefs every
conversation that needs one, so the inbox is ranked before an advisor opens it.

A conversation is eligible when it is not closed, a customer has sent at least one
message in it, and no brief exists that is newer than its last activity. That last
clause is what keeps the pass affordable: an unchanged thread is never re-briefed, so
re-running the pass costs nothing until something actually happens.

Entry points:

- `GET /api/ai/sweep`, authorized with `CRON_SECRET`. Scheduled daily in
  `vercel.json`, after the demo reseed.
- `Run pass` in the inbox header, which runs the same pass scoped to the
  conversations the signed-in user can see, and reports what it did.

Each brief is a paid model call. `AI_PASS_MAX_BRIEFS` bounds a single run, and the
shared demo account is additionally bounded by `DEMO_AI_DAILY_LIMIT`.

Known limit: the staleness check runs in application code, so every pass loads every
non-closed conversation that has an inbound message before it selects which ones to
brief. That candidate scan is unbounded. It is fine at dealership volume and would
need bounding if conversation volume grew materially.

Without `OPENAI_API_KEY` the pass writes nothing, the inbox says AI is not
configured, and no brief is ever fabricated.

## Demo Mode

`DEMO_USER_EMAIL` names the account the login page's `View demo` button signs into.
It is `service@ctxchat.local` (Alyssa Torres, service advisor) because the service
advisor is the product's primary user - the demo has to land inside her work, not on
a manager's dashboard. The demo session lands on `/inbox`.

Leaving `DEMO_USER_EMAIL` unset hides the button and disables the demo provider.

## Production Bootstrap

On a brand-new production database:

1. Set production `DATABASE_URL` to the Neon pooled production URL.
2. Set production `DIRECT_URL` to the Neon direct production URL.
3. Set `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD`.
4. Run migrations:

```bash
pnpm prisma:migrate:deploy
```

1. Run the one-time bootstrap:

```bash
pnpm bootstrap:prod
```

`bootstrap:prod` creates only:

- the first `ADMIN` user
- default dealership settings
- required tags
- starter templates

It intentionally does not create demo customers, conversations, or tasks. It also refuses to run if users already exist.

## Vercel + Neon Deployment Model

Use one `Vercel` project for the full app and one `Next.js` codebase.

- Local envs point at the Neon non-production `dev` branch.
- Preview envs point at the shared Neon non-production `preview` branch.
- Production envs point at the dedicated Neon production database or branch.

Before validating a preview or production deploy, run Prisma migrations against that environment's `DIRECT_URL`.

Preview / production command:

```bash
pnpm prisma:migrate:deploy
```

Vercel deployment and Twilio webhook setup details live in [docs/vercel-twilio-deploy.md](docs/vercel-twilio-deploy.md).

## Twilio

Routes:

- `POST /api/messages/send`
- `POST /api/twilio/inbound`
- `POST /api/twilio/status`

Production SMS in the US requires approved A2P 10DLC registration before sending dealership traffic.

Webhook verification is strict in local, preview, and production:

- `POST /api/twilio/inbound` and `POST /api/twilio/status` only accept Twilio-signed `application/x-www-form-urlencoded` requests with a valid `X-Twilio-Signature`.
- Signature verification uses the existing `TWILIO_AUTH_TOKEN` and the exact incoming `request.url`. There is no separate signing URL env.
- If `TWILIO_AUTH_TOKEN` is missing, webhook routes return `503` and do not mutate app data.
- If the Twilio signature is missing or invalid, webhook routes return `403` and do not mutate app data.
- Signed but unusable payloads, including incomplete inbound messages or unknown outbound status SIDs, return `200 ignored`.

Local and preview webhook setup:

- Use a real public tunnel or public callback URL. Twilio cannot sign requests against `localhost`.
- Point Twilio’s inbound and status callback URLs at that public URL.
- Ensure the URL seen by the app matches the signed request URL exactly, including protocol and host, or verification will fail.
- For manual replay testing, reuse the original signed payload and `MessageSid` to confirm duplicate inbound/status requests return `200` without creating duplicate rows or notifications.
- A step-by-step local validation runbook and replay utility live in [docs/twilio-local-verification.md](docs/twilio-local-verification.md). Use `pnpm twilio:replay` to send valid, missing-signature, or invalid-signature Twilio form posts at the public webhook URL.
- For deployed webhook testing on Vercel instead of a local tunnel, use [docs/vercel-twilio-deploy.md](docs/vercel-twilio-deploy.md).

## Operations Notes

- `/settings` is available to `ADMIN` and `MANAGER`.
- `ADMIN` can create staff users, deactivate/reactivate them, reset passwords, and update dealership defaults.
- Integration health on `/settings` reports database, auth, app URL, and Twilio readiness plus recent outbound delivery failures.

## Out Of Scope In This Slice

- `Stripe` payment flows
- Stripe signature verification hardening
- CI-driven migration automation
- Branch-per-preview Neon automation
