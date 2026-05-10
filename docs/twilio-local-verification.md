# Twilio Local Verification

Use this runbook to validate the hardened Twilio webhook behavior locally with a public tunnel, real Twilio traffic for the happy path, and signed replays for duplicate and failure-path checks.

## Prerequisites

- Local `.env` is configured and `pnpm prisma:generate` has already been run.
- `TWILIO_AUTH_TOKEN` is set locally.
- The Twilio sender is attached to the Messaging Service referenced by `TWILIO_MESSAGING_SERVICE_SID`.
- A public HTTPS tunnel is available for local port `3000`.
- You can sign in as `gm@ctxchat.local` with password `ctxdemo123`.

## Local Startup

1. Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the public tunnel URL.
2. Start the app with `pnpm dev`.
3. Open `/settings` through the public tunnel URL and confirm `Twilio` and `Public app URL` both show healthy.
4. Open Prisma Studio with `pnpm exec prisma studio` for row-level inspection.

## Twilio Console Wiring

In the Twilio Messaging Service used by local dev:

- Set the inbound webhook to `POST <public-url>/api/twilio/inbound`
- Set the delivery status callback to `POST <public-url>/api/twilio/status`

The webhook URL Twilio calls must match the exact public URL the app sees. If the protocol, host, or path differs, signature verification should fail.

## Replay Tool

Use the built-in replay tool to send Twilio-signed form posts:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/inbound \
  --field MessageSid=SM123 \
  --field From=+15551234567 \
  --field Body=hello
```

The tool supports:

- `--signature valid` for a correctly signed request
- `--signature missing` for an unsigned request
- `--signature invalid` for a bad signature
- `--payload-file <path>` for replaying a saved flat JSON payload
- `--auth-token <value>` when the app under test is intentionally missing `TWILIO_AUTH_TOKEN` but the replay itself still needs to be signed

## Acceptance Scenarios

### 1. Real inbound happy path

Send a real SMS from a fresh mobile number to the Twilio sender.

Confirm:

- One new `Customer`
- One open `Conversation`
- One inbound `Message` with the inbound `MessageSid`
- One active unassigned notification visible in `/command-center`
- `/customers` shows `SMS ok`
- `/inbox/<conversationId>` shows the inbound message and `Eligible to receive SMS`

### 2. Duplicate inbound replay

Replay the same inbound payload with the same `MessageSid`:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/inbound \
  --field MessageSid=<same-inbound-sid> \
  --field From=+15551234567 \
  --field Body="Original body"
```

Confirm HTTP `200` and no additional `Customer`, `Conversation`, `Message`, `OptInEvent`, or `Notification` rows.

### 3. STOP and START replay safety

Send a real `STOP` message, then a real `START` message from the same phone.

Confirm:

- `STOP` creates exactly one `OPT_OUT` event and flips the customer to opted out
- `START` creates exactly one `OPT_IN` event and flips the customer back to opted in
- Replaying either signed payload with the same `MessageSid` returns `200` and creates nothing extra

### 4. Signed but unusable inbound payload

Replay a signed inbound request with a fresh `MessageSid` but missing `Body`:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/inbound \
  --field MessageSid=SM_MISSING_BODY \
  --field From=+15551234567
```

Repeat with missing `From`.

Confirm HTTP `200` and no new rows.

### 5. Unauthenticated inbound

Send unsigned and bad-signature versions of the same request:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/inbound \
  --field MessageSid=SM_BAD_SIG \
  --field From=+15551234567 \
  --field Body=test \
  --signature missing
```

```bash
pnpm twilio:replay --url <public-url>/api/twilio/inbound \
  --field MessageSid=SM_BAD_SIG \
  --field From=+15551234567 \
  --field Body=test \
  --signature invalid
```

Confirm HTTP `403` and no data changes.

### 6. Missing auth token

Temporarily remove `TWILIO_AUTH_TOKEN` from the local app process, restart `pnpm dev`, and replay a previously valid request:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/inbound \
  --field MessageSid=SM503TEST \
  --field From=+15551234567 \
  --field Body=test \
  --auth-token <real-twilio-auth-token>
```

Confirm HTTP `503` and no writes. Restore `TWILIO_AUTH_TOKEN` before continuing.

### 7. Live outbound status callback

From the app UI, send an outbound SMS to the same customer.

Confirm:

- The outbound `Message` row receives a `twilioSid`
- Twilio requests `/api/twilio/status`
- The row updates to the mapped delivery state

If no live callback arrives, inspect Twilio request logs before continuing. Do not use replay tests to hide missing sender configuration.

### 8. Duplicate status replay

Replay the most recent live status payload against the same outbound `twilioSid` and confirm HTTP `200` with no duplicate notifications or state churn.

### 9. Failed then delivered status transition

Replay a failed status:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/status \
  --field MessageSid=<real-outbound-sid> \
  --field MessageStatus=failed \
  --field ErrorMessage="Carrier rejected"
```

Confirm:

- The message becomes `FAILED`
- Exactly one active `MESSAGE_FAILED` notification appears in `/command-center`
- `/settings` shows the latest delivery issue

Replay the same failed payload and confirm no duplicate notification.

Then replay a delivered status:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/status \
  --field MessageSid=<real-outbound-sid> \
  --field MessageStatus=delivered
```

Confirm the message becomes `DELIVERED` and the active `MESSAGE_FAILED` notification resolves exactly once.

### 10. Unknown outbound SID

Replay a signed status callback with a fake `MessageSid`:

```bash
pnpm twilio:replay --url <public-url>/api/twilio/status \
  --field MessageSid=SM_UNKNOWN \
  --field MessageStatus=delivered
```

Confirm HTTP `200` with no data changes.

### 11. Unauthenticated and missing-auth-token status checks

Repeat the `403` and `503` checks against `/api/twilio/status` and confirm no `Message` or `Notification` changes.
