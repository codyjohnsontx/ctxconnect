---
name: verify
description: How to run and drive ctxChat locally to verify changes end-to-end (dev server, auth flows via curl, DB checks via tsx).
---

# Verifying ctxChat changes

## Build / launch

- `npm run dev` (port 3000). Next 16 refuses a second dev server for the same dir — if one is already running, reuse it (it hot-reloads code AND `.env` changes) or kill it first.
- Gotcha: a long-running dev server keeps a **stale Prisma client** in its module graph after `prisma generate` / new migrations — Prisma validation errors like "Unknown argument `<compoundUnique>`" mean restart the dev server, not a code bug.
- `npm run build` fails locally at `prisma generate` (`ERR_REQUIRE_ESM` in `@prisma/dev` on Node 20) — pre-existing; run `npx next build` directly to validate the app build against the existing generated client in `src/generated/`.
- `npm run prisma:seed` reseeds demo data (destructive-recreate of seeded conversations; user IDs stable).

## Driving auth flows without a browser

Cookie-jar curl against NextAuth v4 endpoints:

```bash
CSRF=$(curl -s -c jar.txt localhost:3000/api/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
# password login: provider id "credentials" with email/password fields
# demo login: provider id "demo" with turnstileToken field (empty OK when TURNSTILE_SECRET_KEY unset)
curl -s -b jar.txt -c jar.txt -X POST localhost:3000/api/auth/callback/<provider> \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "json=true" [fields...]
curl -s -b jar.txt localhost:3000/api/auth/session   # inspect user/role/isDemo
```

Seeded logins: admin/gm/sales/service/parts `@ctxchat.local`, password `ctxdemo123` unless `SEED_PASSWORD` was set at seed time.

## DB assertions

`npx tsx <script>.ts` from the repo root (inline `tsx -e` chokes on `$disconnect` escaping — write a temp file). Construct the client like `prisma/seed.ts`: `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })` after `import "dotenv/config"`.

## Flows worth driving

- Login page render: `curl -s localhost:3000/login` — grep for what should(n't) be there.
- Demo guardrails: SMS send → 403 as demo; AI brief → live once, 429 past `DEMO_AI_DAILY_LIMIT` (set it to 1 in `.env` for cheap cap tests; each live brief costs ~$0.02).
- Reseed: `curl localhost:3000/api/demo/reseed -H "Authorization: Bearer $CRON_SECRET"` — 401 without/incorrect header, 200 + pristine data with it.
