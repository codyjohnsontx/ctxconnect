import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { sessionCannotBeProvenCurrent } from "../src/lib/session-cutoff";

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
const serverActions = join("src", "app", "actions.ts");

// Edge middleware sits at the repo root rather than under src/, and is the most
// likely place for a token-trusting check to reappear, because getServerSession
// cannot run in that runtime. Scanning src/ alone would leave it invisible.
const rootMiddleware = "middleware.ts";

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
  const files = sourceFiles(join(repoRoot, "src")).map((path) => relative(repoRoot, path));

  return existsSync(join(repoRoot, rootMiddleware)) ? [...files, rootMiddleware] : files;
}

function read(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("session revocation", () => {
  it("resolves the signed-in account in exactly one module", () => {
    // The server-side ways a NextAuth session is most likely to be read:
    // getServerSession, getToken from next-auth/jwt, and withAuth from
    // next-auth/middleware. Pinning only the first would let a route handler or
    // the edge middleware reach for another and trust a 30-day token unchallenged.
    //
    // This is a best-effort textual guard, not a proof, and those are the common
    // paths rather than every one. It matches whole identifiers, tolerates
    // whitespace and an explicit type argument before the call parens, so neither
    // `getToken ({ ... })` nor `getToken<JWT>({ ... })` slips past, and it matches
    // the next-auth/middleware specifier so both `import { withAuth }` and
    // `export { default }` from it are caught. But an aliased import such as
    // `import { getToken as gt }` still defeats it - catching that would mean
    // parsing TypeScript rather than matching text, which is not worth it here,
    // and matching the next-auth/jwt specifier instead would not do it either,
    // because src/types/next-auth.d.ts legitimately declares that module.
    // Decoding the session cookie by hand with next-auth/jwt's `decode` is a
    // second uncovered path, exotic but real. The real contract is the one this
    // test is named for: only src/lib/session.ts reads the session.
    const readsTheSession = /\bgetServerSession\b|\bgetToken\b\s*(?:<[^>]*>\s*)?\(|next-auth\/middleware/;
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
      assert.match(read(path), /from "@\/lib\/session"/, path);
    }
  });

  it("sends a refused form submit to the notice rather than an error screen", () => {
    // Server actions used to throw their own "Authentication required." Nothing
    // catches it and there is no error boundary under src/app, so a form
    // submitted from a tab that was open when the account was switched off
    // ended on Next's raw error screen while a page load got a quiet notice.
    // Going through requireUser redirects both to the same place.
    const actions = read(serverActions);

    assert.match(actions, /import \{ requireUser \} from "@\/lib\/session"/);
    assert.doesNotMatch(actions, /Authentication required/);
  });

  it("stamps a cutoff when an account is switched off and never clears it", () => {
    // The cutoff is what makes deactivation reach a phone as well as a laptop,
    // and what Settings shows as "Access ended". Clearing it on reactivation
    // would wake every session the person still had open on their old devices.
    const actions = read(serverActions);

    assert.match(actions, /"accessEndedAt" = \(clock_timestamp\(\) AT TIME ZONE 'UTC'\)/);
    assert.doesNotMatch(actions, /accessEndedAt.*null/i);
    assert.match(read(sessionResolver), /accessEndedAt: true/);
  });

  it("records a granted request without letting it outrun the cutoff", () => {
    // Two guards, both required. The WHERE means a deactivation that commits
    // first leaves this matching no rows. The timestamp comes from the database
    // inside the statement, so it is read once the row lock is held rather than
    // picked in JavaScript beforehand - a value chosen before the statement is
    // sent can be older than one chosen by a request that commits first, which
    // is how "access ended 2:03, last request 2:04" reaches a manager's screen.
    const resolver = read(sessionResolver);

    assert.match(resolver, /WHERE "id" = \$\{userId\} AND "active" = true/);
    assert.match(resolver, /"lastSeenAt" = \(clock_timestamp\(\) AT TIME ZONE 'UTC'\)/);
    // Skipping and failing are both non-events for a request whose access has
    // already been decided; neither may propagate out of the resolver.
    assert.match(resolver, /catch \(error\)/);
  });

  it("refuses a session minted before the account was switched off", () => {
    const switchedOff = new Date("2026-08-14T12:00:00.000Z");
    const before = switchedOff.getTime() - 1;
    const after = switchedOff.getTime() + 1;

    assert.equal(sessionCannotBeProvenCurrent(before, switchedOff), true);
    // Signed in again after being switched back on.
    assert.equal(sessionCannotBeProvenCurrent(after, switchedOff), false);
    // Never switched off, so nothing to measure against.
    assert.equal(sessionCannotBeProvenCurrent(before, null), false);
  });

  it("refuses a session that carries no sign-in time, cutoff or not", () => {
    // Sessions minted before this claim existed hold no evidence of when they
    // began. The alternative - backfilling a cutoff onto every already-inactive
    // account so the comparison has something to bite on - would write an
    // "Access ended" time nobody can defend onto the screen built to be trusted,
    // and would still be a guess. Refusing costs one sign-in on the deploy that
    // ships this; guessing costs the record its meaning for good.
    //
    // Without this, a null cutoff plus a missing claim resolves to "let them in",
    // so reactivating an account deactivated before this feature shipped would
    // wake its month-old cookie with no sign-in at all.
    assert.equal(sessionCannotBeProvenCurrent(undefined, null), true);
    assert.equal(sessionCannotBeProvenCurrent(null, null), true);
    assert.equal(sessionCannotBeProvenCurrent(undefined, new Date()), true);
    assert.equal(sessionCannotBeProvenCurrent(null, new Date()), true);
  });

  it("names the account as inactive only when the account is inactive", () => {
    // resolveAccount refuses for two different reasons and requireUser has to
    // tell them apart: an advisor deactivated by mistake and put back reads
    // "This account is no longer active." on a session that is merely too old,
    // about an account that demonstrably is active.
    const resolver = read(sessionResolver);

    assert.match(resolver, /accountInactive: true/);
    assert.match(resolver, /redirect\(accountInactive \?/);
  });

  it("stamps the cutoff only on the transition out of active", () => {
    // A second Deactivate press - two admins, or one stale tab - must not move
    // the recorded cutoff later than the moment access actually ended.
    assert.match(read(serverActions), /WHERE "id" = \$\{targetUserId\} AND "active" = true/);
  });
});
