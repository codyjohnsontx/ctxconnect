# CTX Chat

Internal dealership communication app for a single motorcycle dealership.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma 7
- PostgreSQL
- Auth.js / NextAuth credentials login
- Twilio SMS/MMS route structure
- PWA manifest

## Setup

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`.
2. Apply the database schema:

```bash
pnpm prisma:migrate
```

3. Seed demo dealership data:

```bash
pnpm prisma:seed
```

4. Start the app:

```bash
pnpm dev
```

## Seeded Logins

All seeded users use password `ctxdemo123`.

- `admin@ctxchat.local`
- `gm@ctxchat.local`
- `sales@ctxchat.local`
- `service@ctxchat.local`
- `parts@ctxchat.local`

## Twilio

Set these before testing real SMS:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
- `NEXT_PUBLIC_APP_URL`

Routes:

- `POST /api/messages/send`
- `POST /api/twilio/inbound`
- `POST /api/twilio/status`

Production SMS in the US requires approved A2P 10DLC registration before sending dealership traffic.
