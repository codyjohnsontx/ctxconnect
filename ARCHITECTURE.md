# Attend Architecture

## Operating Model

Attend runs as one `Next.js` application deployed as one `Vercel` project.

That deployment serves one thing: the internal staff workspace. There is no public
marketing or customer-facing website in this codebase.

Every UI page requires an authenticated staff session, except `/login`,
`/privacy-policy`, and `/terms-and-conditions`.

A staff session is a 30-day JWT, so holding one is not enough on its own. Every
authenticated page, server action, and route handler resolves the caller through
`src/lib/session.ts`, which re-reads the account row on each request and refuses
the request when the account is missing, `active` is false, the session was
minted at or before the account's `accessEndedAt` cutoff, or the session carries
no `signedInAt` claim at all. Deactivating a staff account therefore cuts off
access on that person's next request rather than when the token expires, on
every device it is signed in on, and the cutoff outlives reactivation: a
reactivated staff member signs in again.

That last rule is the one with an operational consequence. Sessions minted
before `signedInAt` existed carry no evidence of when they began, so they cannot
be shown to postdate a cutoff and are refused rather than guessed at - which
means **the deploy that ships this signs every staff member out once**, on
purpose. The alternative, backfilling a cutoff onto already-inactive accounts,
would have written an "Access ended" time nobody could defend onto the one
screen built to be trusted.

Two admin actions stamp that cutoff. Deactivation sets `active` to false
alongside it. A password reset leaves `active` alone, so the account stays fully
usable and only the sessions minted at or before the reset are gone. The
README's Operations Notes carry what each one means for an admin.

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

The browser keeps two things: the dark mode preference, and the reply an advisor
has typed and not yet sent. The draft is the one that carries customer data, so
it is held per signed-in user and per conversation, expires after twelve hours,
and is removed on sign-out - a dealership front desk is one browser several
people use across a day. The rule is `src/lib/drafts.ts`.

## Deferred Work

This slice explicitly defers:

- `Stripe` payment collection flows
- Stripe data model expansion
- Stripe signature verification hardening
- CI automation for running migrations against preview or production
- per-preview Neon branch automation
