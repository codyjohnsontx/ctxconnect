import twilio from "twilio";
import { DeliveryStatus } from "@/generated/prisma/client";

const TWILIO_SIGNATURE_HEADER = "x-twilio-signature";

export const twilioStatusMap: Record<string, DeliveryStatus> = {
  queued: DeliveryStatus.QUEUED,
  sent: DeliveryStatus.SENT,
  delivered: DeliveryStatus.DELIVERED,
  failed: DeliveryStatus.FAILED,
  undelivered: DeliveryStatus.FAILED,
};

type VerifiedTwilioWebhook =
  | {
      ok: true;
      body: string;
      params: URLSearchParams;
      get(name: string): string;
      getRequired(name: string): string | null;
    }
  | {
      ok: false;
      response: Response;
    };

function logTwilioWebhook(level: "warn" | "error", event: string, details: Record<string, unknown>) {
  console[level](`[twilio-webhook] ${event}`, details);
}

export async function verifyTwilioWebhook(request: Request, route: "inbound" | "status"): Promise<VerifiedTwilioWebhook> {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!authToken) {
    logTwilioWebhook("error", "missing-auth-token", {
      route,
      url: request.url,
      method: request.method,
    });
    return {
      ok: false,
      response: new Response("twilio auth token is not configured", { status: 503 }),
    };
  }

  const signature = request.headers.get(TWILIO_SIGNATURE_HEADER)?.trim();

  if (!signature) {
    logTwilioWebhook("warn", "missing-signature", {
      route,
      url: request.url,
      method: request.method,
    });
    return {
      ok: false,
      response: new Response("missing twilio signature", { status: 403 }),
    };
  }

  const contentType = request.headers.get("content-type")?.trim() ?? "";

  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    logTwilioWebhook("warn", "invalid-content-type", {
      route,
      url: request.url,
      method: request.method,
      contentType,
    });
    return {
      ok: false,
      response: new Response("unsupported media type", { status: 415 }),
    };
  }

  const body = await request.text();
  const params = new URLSearchParams(body);
  const fields = Object.fromEntries(params.entries());
  const isValid = twilio.validateRequest(authToken, signature, request.url, fields);

  if (!isValid) {
    logTwilioWebhook("warn", "signature-mismatch", {
      route,
      url: request.url,
      method: request.method,
      fieldNames: [...params.keys()],
    });
    return {
      ok: false,
      response: new Response("invalid twilio signature", { status: 403 }),
    };
  }

  return {
    ok: true,
    body,
    params,
    get(name: string) {
      return String(params.get(name) ?? "").trim();
    },
    getRequired(name: string) {
      const value = params.get(name);
      return typeof value === "string" ? value.trim() || null : null;
    },
  };
}

export function logAuthenticatedTwilioPayloadIssue(
  route: "inbound" | "status",
  issue: string,
  details: Record<string, unknown>,
) {
  logTwilioWebhook("warn", issue, {
    route,
    ...details,
  });
}
