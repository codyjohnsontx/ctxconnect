# Vercel + Twilio Deployment

Use this guide when you want Twilio to hit a real deployed URL instead of a local tunnel.

## Recommended Shape

- Use one stable Vercel project domain for Twilio webhook testing.
- Prefer a fixed production domain or stable custom domain over a changing preview URL.
- Point Twilio at the exact deployed URL the app sees.

Preview URLs work technically, but every deploy can change the hostname. Because this app verifies Twilio signatures against the exact incoming URL, Twilio must be updated whenever the URL changes.

## Required Vercel Environment Variables

The variable list lives in the README's [Environment Contract](../README.md#environment-contract). Set every variable it lists in the Vercel project before deploying.

Vercel-specific notes:

- `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` must match the deployed hostname exactly. See `URL Values` below.
- `DATABASE_URL` and `DIRECT_URL` differ per Vercel environment. See `Neon Database Mapping` below.
- `CRON_SECRET` must be set for the scheduled routes in `vercel.json` to run. Without it they reject every request.

## URL Values

For a stable production deployment:

- `NEXTAUTH_URL=https://<your-stable-domain>`
- `NEXT_PUBLIC_APP_URL=https://<your-stable-domain>`

For a preview deployment:

- `NEXTAUTH_URL=https://<that-preview-domain>`
- `NEXT_PUBLIC_APP_URL=https://<that-preview-domain>`

These must match the real deployed hostname you use for Twilio callbacks.

## Neon Database Mapping

This repo expects:

- Local `DATABASE_URL` -> Neon non-production `dev`
- Preview `DATABASE_URL` -> Neon non-production `preview`
- Production `DATABASE_URL` -> Neon production

And similarly:

- Local `DIRECT_URL` -> Neon non-production `dev` direct URL
- Preview `DIRECT_URL` -> Neon non-production `preview` direct URL
- Production `DIRECT_URL` -> Neon production direct URL

## Deployment Order

### Preview

1. Set preview envs in Vercel.
1. Run migrations against the preview `DIRECT_URL`:

```bash
pnpm prisma:migrate:deploy
```

1. Deploy or redeploy the Vercel project.
1. Open `/settings` on the preview URL and confirm database, auth, app URL, and Twilio all show healthy.

### Production

1. Set production envs in Vercel.
1. Run migrations against the production `DIRECT_URL`:

```bash
pnpm prisma:migrate:deploy
```

1. If the production database is brand new, run:

```bash
pnpm bootstrap:prod
```

1. Deploy or redeploy production.
1. Sign in with the bootstrap admin account and confirm `/settings` is healthy.

## Twilio Webhook Values

Point Twilio at the deployed app URL:

- Inbound webhook: `POST https://<your-stable-domain>/api/twilio/inbound`
- Delivery status callback: `POST https://<your-stable-domain>/api/twilio/status`

If you are using a Twilio Messaging Service, configure those values on the Messaging Service used for outbound sends.

## Validation Checklist

After deployment:

1. Open `/settings` and confirm:
   - `Twilio` is healthy
   - `Public app URL` is healthy
   - no unexpected auth or database failures appear
1. Send a real inbound SMS and confirm customer/conversation/message creation.
1. Send an outbound SMS from the app and confirm a `twilioSid` is stored.
1. Confirm Twilio requests the deployed `/api/twilio/status` URL.
1. Run the replay checks from [twilio-local-verification.md](./twilio-local-verification.md), but replace the tunnel URL with the Vercel deployment URL.

## Failure Cases To Watch

- `403` usually means the Twilio callback URL does not exactly match the deployed URL receiving the request, or the signature is otherwise invalid.
- `503` means `TWILIO_AUTH_TOKEN` is missing from the deployed environment.
- If outbound sends work but no status callbacks arrive, the sender or Messaging Service callback configuration is incomplete in Twilio.
