import { readFile } from "node:fs/promises";
import process from "node:process";
import twilio from "twilio";

type SignatureMode = "valid" | "missing" | "invalid";

type CliOptions = {
  url: string;
  authToken?: string;
  payloadFile?: string;
  signature: SignatureMode;
  fields: Array<[string, string]>;
};

function printUsage() {
  console.log(`Usage:
  pnpm twilio:replay --url <public-webhook-url> [--field Key=Value ...] [--payload-file path.json]

Options:
  --url             Full public webhook URL to sign and call.
  --field           Repeatable form field in Key=Value format.
  --payload-file    JSON file with a flat object of Twilio form fields.
  --auth-token      Override TWILIO_AUTH_TOKEN for signature generation.
  --signature       valid | missing | invalid (default: valid)
  --help            Print this usage text.

Examples:
  pnpm twilio:replay --url https://example.ngrok-free.app/api/twilio/inbound \\
    --field MessageSid=SM123 --field From=+15551234567 --field Body=hello

  pnpm twilio:replay --url https://example.ngrok-free.app/api/twilio/status \\
    --field MessageSid=SM123 --field MessageStatus=failed --field ErrorMessage="Carrier rejected" \\
    --signature invalid
`);
}

function requireOptionValue(flag: string, value: string | undefined) {
  if (!value || value.startsWith("--")) {
    throw new Error(`Expected a value after ${flag}.`);
  }

  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    url: "",
    signature: "valid",
    fields: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--url") {
      options.url = requireOptionValue("--url", next);
      index += 1;
      continue;
    }

    if (arg === "--auth-token") {
      options.authToken = requireOptionValue("--auth-token", next);
      index += 1;
      continue;
    }

    if (arg === "--payload-file") {
      options.payloadFile = requireOptionValue("--payload-file", next);
      index += 1;
      continue;
    }

    if (arg === "--signature") {
      if (next === "valid" || next === "missing" || next === "invalid") {
        options.signature = next;
      } else {
        throw new Error(`Invalid --signature value: ${next ?? "<missing>"}`);
      }
      index += 1;
      continue;
    }

    if (arg === "--field") {
      if (!next?.includes("=")) {
        throw new Error(`Expected Key=Value after --field, received ${next ?? "<missing>"}`);
      }

      const separatorIndex = next.indexOf("=");
      const key = next.slice(0, separatorIndex).trim();
      const value = next.slice(separatorIndex + 1);

      if (!key) {
        throw new Error(`Invalid empty field name in ${next}`);
      }

      options.fields.push([key, value]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.url) {
    throw new Error("Missing required --url option.");
  }

  return options;
}

function normalizePayloadRecord(payload: Record<string, unknown>) {
  return Object.entries(payload).reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (value === undefined || value === null) {
      return accumulator;
    }

    accumulator[key] = String(value);
    return accumulator;
  }, {});
}

async function loadPayload(options: CliOptions) {
  const fieldEntries = new Map<string, string>();

  if (options.payloadFile) {
    const raw = await readFile(options.payloadFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Payload file must contain a flat JSON object.");
    }

    const normalized = normalizePayloadRecord(parsed as Record<string, unknown>);

    for (const [key, value] of Object.entries(normalized)) {
      fieldEntries.set(key, value);
    }
  }

  for (const [key, value] of options.fields) {
    fieldEntries.set(key, value);
  }

  if (fieldEntries.size === 0) {
    throw new Error("Provide at least one payload field with --field or --payload-file.");
  }

  const payload = Object.fromEntries(fieldEntries);
  const body = new URLSearchParams(payload).toString();

  return { payload, body };
}

function buildSignature(
  authToken: string | undefined,
  url: string,
  payload: Record<string, string>,
  mode: SignatureMode,
) {
  if (mode === "missing") {
    return null;
  }

  if (!authToken) {
    throw new Error("TWILIO_AUTH_TOKEN is required for valid or invalid signature modes.");
  }

  const expected = twilio.getExpectedTwilioSignature(authToken, url, payload);

  if (mode === "valid") {
    return expected;
  }

  return `${expected}-invalid`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { payload, body } = await loadPayload(options);
  const authToken = options.authToken || process.env.TWILIO_AUTH_TOKEN?.trim();
  const signature = buildSignature(authToken, options.url, payload, options.signature);

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };

  if (signature) {
    headers["x-twilio-signature"] = signature;
  }

  console.log(`POST ${options.url}`);
  console.log(`Signature mode: ${options.signature}`);
  console.log("Payload:");
  console.log(JSON.stringify(payload, null, 2));

  const response = await fetch(options.url, {
    method: "POST",
    headers,
    body,
  });

  const responseBody = await response.text();

  console.log(`Response: ${response.status} ${response.statusText}`);
  console.log(responseBody);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
