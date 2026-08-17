---
name: verify
description: How to run and drive Attend locally to verify changes end-to-end (dev server, auth flows via curl, DB checks via tsx).
---

# Verifying Attend changes

## Build / launch

- `npm run dev` (port 3000). Next 16 refuses a second dev server for the same dir — if one is already running, reuse it (it hot-reloads code AND `.env` changes) or kill it first.
- Gotcha: a long-running dev server keeps a **stale Prisma client** in its module graph after `prisma generate` / new migrations — Prisma validation errors like "Unknown argument `<compoundUnique>`" mean restart the dev server, not a code bug.
- `npm run build` fails locally at `prisma generate` (`ERR_REQUIRE_ESM` in `@prisma/dev` on Node 20) — pre-existing; run `npx --no-install next build` directly to validate the app build against the existing generated client in `src/generated/`.
- `next build` needs `DATABASE_URL` **in the environment** — it does not load `.env` for the Prisma-client module eval during page-data collection, so a clean build errors with "DATABASE_URL is required to create the Prisma client" on every Prisma-importing route (`/login`, etc.). `next build` only needs `DATABASE_URL` (that's all `src/lib/prisma.ts` reads). Export it first: `export $(grep -E '^DATABASE_URL=' .env | sed 's/\"//g')` then `npx --no-install next build`. (On Vercel it's a real build env var, so CI/prod builds fine.)
- `npm run prisma:seed` reseeds demo data (destructive-recreate of seeded conversations; user IDs stable). With `OPENAI_API_KEY` set it also regenerates every seeded AI brief through the real model, so the seed costs money: `SEED_AI_BRIEFS=false` skips that step (see the README's seed section).

## Local database

`.env` is gitignored, so a fresh worktree inherits whatever URL the last session wrote - usually a dead `prisma dev` port. Check it before blaming the app.

- **Do not point `DATABASE_URL` at a `prisma dev` server.** Any page that issues concurrent queries (`getInboxData` runs a `Promise.all`) intermittently dies with `DriverAdapterError: bind message supplies N parameters, but prepared statement "" requires M`, where N and M vary per request. That is Postgres wire-protocol desync through the `prisma dev` proxy, not a code bug - `/inbox` may survive while `/inbox/[conversationId]` 500s every time. Use a plain Postgres instead: create a database on a real server, point `DATABASE_URL` and `DIRECT_URL` at it with no extra query params, `prisma migrate deploy`, then seed.
- Extra libpq-style params in the URL (`connection_limit`, `pool_timeout`, …) make the desync above much more frequent. Keep the URL bare.

## Driving the send path

`DEMO_USER_EMAIL` is often set to `service@ctxchat.local` locally - the primary-user account. `isDemo` is stamped into the JWT at sign-in from that variable, so the service advisor is demo-capped and `POST /api/messages/send` returns 403 before it reaches any send logic. To exercise sending, repoint `DEMO_USER_EMAIL` at something else, then **sign out and back in** (editing `.env` alone does not restamp an existing token).

Twilio is normally unconfigured locally, so a send is persisted and then marked `FAILED` with a 503 rather than reaching a carrier. That is the cheapest way to produce a failed-delivery state to look at.

## Driving auth flows without a browser

Cookie-jar curl against NextAuth v4 endpoints:

```bash
CSRF=$(curl -s -c jar.txt localhost:3000/api/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
# password login: provider id "credentials" with email/password fields
# demo login: provider id "demo" with turnstileToken field (empty OK only in local dev when
# TURNSTILE_SECRET_KEY is unset — production fails closed without a valid token)
curl -s -b jar.txt -c jar.txt -X POST localhost:3000/api/auth/callback/<provider> \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "json=true" [fields...]
curl -s -b jar.txt localhost:3000/api/auth/session   # inspect user/role/isDemo
```

Seeded logins: admin/gm/sales/service/parts `@ctxchat.local`, password `ctxdemo123` unless `SEED_PASSWORD` was set at seed time.

## DB assertions

`npx --no-install tsx <script>.ts` from the repo root (inline `tsx -e` chokes on `$disconnect` escaping — write a temp file). Construct the client like `prisma/seed.ts`: `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })` after `import "dotenv/config"`.

## Flows worth driving

- Login page render: `curl -s localhost:3000/login` — grep for what should(n't) be there.
- Demo guardrails: SMS send → 403 as demo; AI brief → live once, 429 past `DEMO_AI_DAILY_LIMIT` (set it to 1 in `.env` for cheap cap tests; each live brief costs ~$0.02).
- Reseed: `curl localhost:3000/api/demo/reseed -H "Authorization: Bearer $CRON_SECRET"` — 401 without/incorrect header, 200 + pristine data with it.
- Ambient AI pass: `curl localhost:3000/api/ai/sweep -H "Authorization: Bearer $CRON_SECRET"` - same auth contract as reseed. Each brief is a paid call.
  - A second immediate run briefs 0 only when the first run both succeeded and covered every eligible conversation. That is the staleness rule working; it is not what a second run always returns.
  - A provider failure persists no insight, so that conversation stays stale and is retried by the next run. Expect `failed > 0` on the first run to reappear as `eligible > 0` on the second.
  - If eligibility exceeded `AI_PASS_MAX_BRIEFS`, the first run reports `deferred > 0` and the second run briefs that remainder rather than returning 0.
