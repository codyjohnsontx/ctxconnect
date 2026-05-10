# Vercel + Twilio Deployment

Use this guide when you want Twilio to hit a real deployed URL instead of a local tunnel.

## Recommended Shape

- Use one stable Vercel project domain for Twilio webhook testing.
- Prefer a fixed production domain or stable custom domain over a changing preview URL.
- Point Twilio at the exact deployed URL the app sees.

Preview URLs work technically, but every deploy can change the hostname. Because this app verifies Twilio signatures against the exact incoming URL, Twilio must be updated whenever the URL changes.

## Required Vercel Environment Variables

Set these in the Vercel project before deploying:

### Runtime app env

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`

### CLI / admin env

- `DIRECT_URL`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

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
2. Run migrations against the preview `DIRECT_URL`:

```bash
pnpm prisma:migrate:deploy
```

3. Deploy or redeploy the Vercel project.
4. Open `/settings` on the preview URL and confirm database, auth, app URL, and Twilio all show healthy.

### Production

1. Set production envs in Vercel.
2. Run migrations against the production `DIRECT_URL`:

```bash
pnpm prisma:migrate:deploy
```

3. If the production database is brand new, run:

```bash
pnpm bootstrap:prod
```

4. Deploy or redeploy production.
5. Sign in with the bootstrap admin account and confirm `/settings` is healthy.

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
2. Send a real inbound SMS and confirm customer/conversation/message creation.
3. Send an outbound SMS from the app and confirm a `twilioSid` is stored.
4. Confirm Twilio requests the deployed `/api/twilio/status` URL.
5. Run the replay checks from [twilio-local-verification.md](/Users/codypjohnson/Desktop/Coding/ctxChat/docs/twilio-local-verification.md:1), but replace the tunnel URL with the Vercel deployment URL.

## Failure Cases To Watch

- `403` usually means the Twilio callback URL does not exactly match the deployed URL receiving the request, or the signature is otherwise invalid.
- `503` means `TWILIO_AUTH_TOKEN` is missing from the deployed environment.
- If outbound sends work but no status callbacks arrive, the sender or Messaging Service callback configuration is incomplete in Twilio.
