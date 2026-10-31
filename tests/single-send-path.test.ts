import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Every text Attend sends has to pass the consent gate, and the gate is only a
// guarantee while there is exactly one way to reach Twilio. These pin that
// way: one module holds a Twilio client and spends permits, one route calls
// it, only the gate makes a permit, and only env.ts reads the credentials. A
// second client, a cast to a permit, or a new caller fails here rather than in
// a customer's phone.
//
// A textual guard, not a proof: it matches the spellings a second path would
// most plausibly take, and an aliased re-export could still defeat it. The
// permit's brand is also checked at runtime by the sender, and Twilio's own
// STOP block is the last layer.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SENDER = join("src", "lib", "sms-send.ts");
const GATE = join("src", "lib", "send-gate.ts");
const SEND_ROUTE = join("src", "app", "api", "messages", "send", "route.ts");
const ENV = join("src", "lib", "env.ts");
// Imports the package for what is not sending: verifying an inbound webhook's
// signature, and signing a replayed one in the local verification script.
const WEBHOOK_VERIFIER = join("src", "lib", "twilio.ts");
const REPLAY_SCRIPT = join("scripts", "twilio-replay.ts");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "generated" || entry.name === "node_modules" ? [] : sourceFiles(path);
    }

    return /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

/** Authored code that ships or runs against real services: the app, the seed and the scripts. */
function scannedFiles() {
  const roots = ["src", "prisma", "scripts"].map((root) => join(repoRoot, root));
  const files = roots.flatMap(sourceFiles).map((path) => relative(repoRoot, path));

  return existsSync(join(repoRoot, "middleware.ts")) ? [...files, "middleware.ts"] : files;
}

function read(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function filesMatching(pattern: RegExp) {
  return scannedFiles()
    .filter((path) => pattern.test(read(path)))
    .sort();
}

// `import twilio from "twilio"`, `import { Twilio } from "twilio/lib/..."`,
// `import "twilio"`, `require("twilio")` and `await import("twilio")`.
const TWILIO_PACKAGE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']twilio(?:\/[^"']*)?["']/;
// The client factory, `new Twilio(...)`, or the send or list call on any
// client: the reconciler's read of Twilio's messages lives with the sender too.
const TWILIO_CLIENT = /\btwilio\s*\(|\bnew\s+Twilio\b|\bmessages\s*\.\s*(?:create|list)\s*\(/;
// Any way of telling the compiler an object is a permit without the gate making it.
const PERMIT_CAST = /\bas\s+(?:unknown\s+as\s+)?SendPermit\b|<\s*SendPermit\s*>|\bsatisfies\s+SendPermit\b/;
const TWILIO_SECRETS = /\bTWILIO_(?:ACCOUNT_SID|AUTH_TOKEN)\b/;

describe("the single send path", () => {
  it("imports the Twilio package only to send, to verify a webhook, or to sign a replay", () => {
    assert.deepEqual(filesMatching(TWILIO_PACKAGE), [REPLAY_SCRIPT, WEBHOOK_VERIFIER, SENDER].sort());
  });

  it("builds a Twilio client and calls its send and list APIs in one module", () => {
    assert.deepEqual(filesMatching(TWILIO_CLIENT), [SENDER]);
  });

  it("reaches the sender from the send route alone", () => {
    assert.deepEqual(filesMatching(/\bsendCustomerText\s*\(/), [SENDER, SEND_ROUTE].sort());
    // The permit-spending call is private to the sender, so nothing else can
    // reach Twilio with a permit it obtained some other way.
    assert.deepEqual(filesMatching(/\bsendSms\b/), [SENDER]);
    assert.doesNotMatch(read(SENDER), /export\s+(?:async\s+)?function\s+sendSms\b/);
  });

  it("makes a permit only in the gate", () => {
    assert.deepEqual(filesMatching(PERMIT_CAST), []);
    assert.deepEqual(filesMatching(/\bdecideSend\s*\(/), [GATE, SENDER].sort());
  });

  it("decides from the ledger, the clock and the thread, never from a model", () => {
    const imports = [...read(GATE).matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]).sort();

    assert.deepEqual(imports, ["@/generated/prisma/enums", "@/lib/consent"]);
  });

  it("reads the Twilio credentials only in env.ts", () => {
    assert.deepEqual(
      filesMatching(TWILIO_SECRETS).filter((path) => path.split(sep)[0] !== "scripts"),
      [ENV],
    );
  });
});
