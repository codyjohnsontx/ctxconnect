# CTX Chat

CTX Chat is a single `Next.js` app for both the public website and the internal staff workspace for one motorcycle dealership.

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

The local seed creates demo customers, conversations, tasks, notifications, tags, and templates. Do not use it for production initialization.

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

## Twilio

Routes:

- `POST /api/messages/send`
- `POST /api/twilio/inbound`
- `POST /api/twilio/status`

Production SMS in the US requires approved A2P 10DLC registration before sending dealership traffic.

## Operations Notes

- `/settings` is available to `ADMIN` and `MANAGER`.
- `ADMIN` can create staff users, deactivate/reactivate them, reset passwords, and update dealership defaults.
- Integration health on `/settings` reports database, auth, app URL, and Twilio readiness plus recent outbound delivery failures.

## Out Of Scope In This Slice

- `Stripe` payment flows
- Twilio or Stripe signature verification hardening
- CI-driven migration automation
- Branch-per-preview Neon automation
