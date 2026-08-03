import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { INVOCATION_BUDGET_MS } from "../src/lib/ai/ops-brief";

// Every route that hosts a sequential loop of provider calls declares its own
// maxDuration, and the deadline that stops those loops is derived from
// INVOCATION_BUDGET_MS. Nothing in the language ties the two together: Next.js
// reads maxDuration at build time, so the routes cannot reference the constant.
// Four literals that must agree with one constant will drift the first time
// someone edits one of them, and the failure that costs is the one this branch
// already had twice, a budget that did not fit the invocation it ran in.
//
// A comment asks. This asserts.
//
// A new route that runs briefs in a loop is only covered once it is added here.

const ROUTES_HOSTING_A_BRIEF_LOOP = [
  "src/app/api/ai/sweep/route.ts",
  "src/app/api/demo/reseed/route.ts",
  "src/app/(app)/inbox/page.tsx",
  "src/app/(app)/inbox/[conversationId]/page.tsx",
] as const;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Deliberately matches a bare numeric literal only. A computed value would be
// silently ignored by Next.js at build time, so a test that accepted one would
// pass while production ran on the platform default.
const STATIC_MAX_DURATION = /^export const maxDuration = (\d[\d_]*);$/m;

function declaredMaxDuration(relativePath: string) {
  const source = readFileSync(`${repoRoot}${relativePath}`, "utf8");
  const match = source.match(STATIC_MAX_DURATION);

  assert.ok(
    match,
    `${relativePath} does not export a static numeric maxDuration. It runs a sequential loop of provider calls, so without one it gets the platform default and is killed mid-loop.`,
  );

  return Number(match[1].replace(/_/g, ""));
}

describe("invocation budget", () => {
  it("is declared in seconds by every route that hosts a brief loop", () => {
    const expectedSeconds = INVOCATION_BUDGET_MS / 1000;

    for (const relativePath of ROUTES_HOSTING_A_BRIEF_LOOP) {
      assert.equal(
        declaredMaxDuration(relativePath),
        expectedSeconds,
        `${relativePath} declares a maxDuration that disagrees with INVOCATION_BUDGET_MS. The loop deadline is derived from that constant, so a route budgeting less is killed before the deadline can stop it, and one budgeting more pays for time the deadline will never use.`,
      );
    }
  });
});
