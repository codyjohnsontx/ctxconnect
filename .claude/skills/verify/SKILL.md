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
