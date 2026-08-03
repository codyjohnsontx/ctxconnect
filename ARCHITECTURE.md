# CTX Chat Architecture

## Operating Model

CTX Chat runs as one `Next.js` application deployed as one `Vercel` project.

That deployment serves one thing: the internal staff workspace. There is no public
marketing or customer-facing website in this codebase.

Every UI page requires an authenticated staff session, except `/login`,
`/privacy-policy`, and `/terms-and-conditions`.

The API routes are not UI pages and do not share one contract. Most of them still
run on a staff session: `POST /api/messages/send`, `POST /api/ai/ops-brief`, and
`POST /api/ai/ops-brief/[insightId]/action` each require a session and then check
that the caller may see the conversation. The rest authorize on something else
entirely:

- `/api/auth/*` are the NextAuth endpoints that issue a session in the first place,
  so they are reachable before one exists.
- `GET /api/ai/sweep` and `GET /api/demo/reseed` are cron entry points, authorized
  by a `CRON_SECRET` bearer token and never by a staff session.
- `POST /api/twilio/inbound` and `POST /api/twilio/status` are carrier webhooks,
  authorized by `X-Twilio-Signature` verification against `TWILIO_AUTH_TOKEN`.

The database model is explicit:

- one Neon production database or project
- one separate Neon non-production database or project
- one long-lived non-production `dev` branch for local development
- one long-lived non-production `preview` branch shared by all Vercel preview deployments

This rollout assumes a fresh start. There is no real-data migration in scope.

## Database Contract

`DATABASE_URL`

- pooled Neon connection
- runtime app connection only
- required anywhere the Next.js app executes

`DIRECT_URL`

- direct Neon connection
- Prisma CLI and migration connection
- required for `prisma migrate` and one-time admin scripts

The runtime app should not depend on `DIRECT_URL`.

## Prisma Workflow

Local development:

```bash
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
```

Preview and production:

```bash
pnpm prisma:migrate:deploy
```

Production first-run bootstrap:

```bash
pnpm bootstrap:prod
```

The repository now tracks its initial Prisma migration baseline in `prisma/migrations`.

## Initialization Strategy

Local development uses `prisma/seed.ts`.

That seed is intentionally demo-heavy and creates:

- multiple staff users
- demo customers
- demo conversations and tasks
- notifications
- starter templates and tags

Production uses `prisma/bootstrap-prod.ts`.

That bootstrap is intentionally minimal and creates only:

- the first admin user from env
- default dealership settings
- required tags
- starter templates

It does not create demo customers, conversations, or tasks.

## Vercel Environment Mapping

Use one Vercel project with separate environment values for:

- Local
- Preview
- Production

Recommended mapping:

- Local `DATABASE_URL` -> Neon non-production `dev` pooled URL
- Local `DIRECT_URL` -> Neon non-production `dev` direct URL
- Preview `DATABASE_URL` -> Neon non-production `preview` pooled URL
- Preview `DIRECT_URL` -> Neon non-production `preview` direct URL
- Production `DATABASE_URL` -> Neon production pooled URL
- Production `DIRECT_URL` -> Neon production direct URL

Before preview verification or production verification, run migrations against the target `DIRECT_URL`.

## Release Runbook

1. Create one Neon non-production database or project and one separate Neon production database or project.
2. Create the non-production `dev` and `preview` branches.
3. Configure one Vercel project with local, preview, and production env sets.
4. For local work, run `pnpm prisma:migrate` and `pnpm prisma:seed` against non-production `dev`.
5. Before checking a preview deploy, run `pnpm prisma:migrate:deploy` against non-production `preview`.
6. Before checking a production deploy, run `pnpm prisma:migrate:deploy` against production.
7. On an empty production database, run `pnpm bootstrap:prod` once.
8. Verify production sign-in with the bootstrap admin account.

## Service Boundaries

Neon stores:

- users and staff accounts
- roles and permissions
- customers and vehicles
- conversations and messages
- tasks and follow-ups
- dealership settings
- templates, tags, notifications, and audit records

Twilio handles:

- outbound messaging
- inbound webhooks
- delivery status callbacks

## Deferred Work

This slice explicitly defers:

- `Stripe` payment collection flows
- Stripe data model expansion
- Stripe signature verification hardening
- CI automation for running migrations
- per-preview Neon branch automation
