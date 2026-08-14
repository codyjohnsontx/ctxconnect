import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// Sessions are 30-day JWTs, so the token keeps asserting an account, a role and
// a department long after an admin deactivates or removes it. An entry point
// that reads the token directly and trusts what comes back therefore lets a
// deactivated staff member keep reading customer threads and writing to them
// for a month. src/lib/session.ts re-reads the account from the database, and
// these pin it as the only place allowed to resolve who is signed in, so a new
// page, action or route handler cannot quietly reintroduce the gap.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// The module that owns the database re-read, and the NextAuth configuration it
// passes to getServerSession.
const sessionResolver = join("src", "lib", "session.ts");
const authConfig = join("src", "lib", "auth.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Generated Prisma client, not authored source.
      return entry.name === "generated" ? [] : sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function relativeSourceFiles() {
  return sourceFiles(join(repoRoot, "src")).map((path) => relative(repoRoot, path));
}

function read(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("session revocation", () => {
  it("resolves the signed-in account in exactly one module", () => {
    // Both supported server-side ways to read a NextAuth session: getServerSession
    // and getToken from next-auth/jwt. Pinning only the first would let a route
    // handler reach for the second and trust a 30-day token unchallenged.
    const readsTheSession = /getServerSession|getToken\(/;
    const callers = relativeSourceFiles().filter((path) => readsTheSession.test(read(path)));

    assert.deepEqual(callers, [sessionResolver]);
  });

  it("re-reads that account from the database rather than trusting the token", () => {
    const resolver = read(sessionResolver);

    assert.match(resolver, /prisma\.user\.findUnique/);
    assert.match(resolver, /active: true/);
  });

  it("keeps the deactivated account out, not just the deleted one", () => {
    // `!account?.active` covers both in one check: a missing row and a row with
    // active false. Narrowing it to a null check would silently restore a
    // deactivated employee's access.
    assert.match(read(sessionResolver), /if \(!account\?\.active\)/);
  });

  it("still refuses a deactivated account at sign-in", () => {
    // The resolver ends a session already in flight; this is the other half,
    // and stops a deactivated employee from simply signing in again.
    assert.match(read(authConfig), /if \(!user\?\.active\)/);
  });

  it("routes every authenticated entry point through the resolver", () => {
    // Anything under src/app that authenticates has to import the resolver,
    // because it can no longer reach the session any other way.
    const entryPoints = relativeSourceFiles().filter(
      (path) =>
        path.startsWith(`src${sep}app${sep}`) &&
        /requireUser|getActiveSessionUser|requireSessionUser/.test(read(path)),
    );

    assert.ok(entryPoints.length > 0, "expected authenticated entry points under src/app");

    for (const path of entryPoints) {
      assert.match(read(path), /from "@\/lib\/session"|requireSessionUser/, path);
    }
  });
});
