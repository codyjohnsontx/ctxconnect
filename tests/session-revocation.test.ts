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

/**
 * One exported server action's body, so an assertion about how a reset writes
 * the cutoff cannot be satisfied by the deactivation a few lines above it.
 */
function serverAction(name: string) {
  const [, body] = read(serverActions).split(`export async function ${name}(`);

  assert.ok(body, `expected a ${name} server action`);

  return body.split("\nexport ")[0];
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

    assert.match(actions, /\brequireUser\b[^\n]*from "@\/lib\/session"/);
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
    // A tie fails closed. The two values are rounded to the millisecond by
    // different paths, so a sign-in and a deactivation in the same millisecond
    // can land on the same number, and a tie here resolves against access.
    assert.equal(sessionCannotBeProvenCurrent(switchedOff.getTime(), switchedOff), true);
  });

  it("records an account status change only when something changed", () => {
    // A repeat Deactivate from a stale tab correctly moves nothing, but it used
    // to append an audit row saying the account was deactivated at that later
    // moment. Audit logs exist to be read back by someone reconstructing an
    // incident, and a row for an event that did not happen misleads exactly
    // that person.
    assert.match(read(serverActions), /if \(changed > 0\) \{\s*await prisma\.auditLog\.create/);
  });

  it("reads every timestamp the cutoff compares from one clock", () => {
    // signedInAt is compared against accessEndedAt, and lastSeenAt is read
    // beside it. All three come from the database clock: a second clock means a
    // session minted just before a deactivation can carry a time after the
    // cutoff and survive it, and an access record whose two lines were written
    // by different clocks can print them out of order.
    const auth = read(authConfig);

    // Stamped inside authorize and carried forward, never re-read here.
    assert.match(auth, /token\.signedInAt = user\.signedInAt/);
    assert.doesNotMatch(auth, /signedInAt = Date\.now\(\)/);
    // As a number, not a timestamp. Selecting clock_timestamp() directly came
    // back through the driver with its zone already lost - five hours early on
    // a America/Chicago host - which would have made every session look older
    // than every cutoff. Caught by running it, not by reading it.
    assert.match(auth, /EXTRACT\(EPOCH FROM clock_timestamp\(\)\) \* 1000/);
  });

  it("stamps the sign-in time before authentication runs, not after", () => {
    // Read at the end, signedInAt recorded when authentication FINISHED, and a
    // cost-12 bcrypt compare sits in the middle of that: an admin deactivating
    // during those few hundred milliseconds would see the completing session
    // claim an instant after the cutoff, which the cutoff then would not refuse.
    // Reading it first inverts the failure direction - a deactivation landing
    // after this point stamps a later cutoff and the session is refused, and one
    // landing before it is caught by the account read that follows.
    const auth = read(authConfig);

    for (const authorizeBody of auth.split("async authorize(").slice(1)) {
      const stamp = authorizeBody.indexOf("await databaseNow()");
      const accountRead = authorizeBody.indexOf("prisma.user.findUnique");

      assert.ok(stamp > -1, "every authorize stamps a sign-in time");
      assert.ok(stamp < accountRead, "the stamp precedes the account read");
    }

    // The password compare is the expensive part, and it must come after too.
    const passwordProvider = auth.split("async authorize(")[1];
    assert.ok(
      passwordProvider.indexOf("await databaseNow()") < passwordProvider.indexOf("await compare("),
      "the stamp precedes the password compare",
    );
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
    assert.match(serverAction("updateStaffUserStatus"), /WHERE "id" = \$\{targetUserId\} AND "active" = true/);
  });

  it("ends every session on the account when its password is reset", () => {
    // Writing the hash alone changes what the person types at the sign-in form
    // and nothing else, so a session on a stolen laptop carried on for the rest
    // of its 30 days. The cutoff is what reaches that laptop.
    const reset = serverAction("resetStaffPassword");

    assert.match(reset, /"passwordHash" = \$\{passwordHash\}/);
    assert.match(
      reset,
      /"accessEndedAt" = CASE WHEN "active" THEN \(clock_timestamp\(\) AT TIME ZONE 'UTC'\) ELSE "accessEndedAt" END/,
    );
  });

  it("leaves the account usable after a password reset", () => {
    // The whole point of stamping the cutoff without touching `active`: the
    // sessions are gone, the account is not. Setting active here would turn a
    // password reset into a deactivation the admin did not ask for.
    assert.doesNotMatch(serverAction("resetStaffPassword"), /"active" = /);
  });

  it("moves the cutoff on every reset, not only the first", () => {
    // Deactivation guards its WHERE on `active = true` because a repeat press
    // is not a real transition. A reset has no such state: the second reset in
    // a minute is a new password, and the sessions minted between the two must
    // go with it. Guarding the WHERE would also stop the new hash reaching a
    // deactivated account, which an admin may legitimately write before
    // reactivating someone.
    assert.doesNotMatch(serverAction("resetStaffPassword"), /WHERE[^\n]*"active"/);
  });

  it("leaves a deactivation record alone when that account's password is reset", () => {
    // Reset is offered on every row, including an inactive one. On a live
    // account the stamp is what ends the sessions; on an account that is
    // already off, the cutoff is the deactivation record Settings renders as
    // "Access ended", and restamping it would replace the moment the person
    // actually lost access with an unrelated later one. Nothing is lost by
    // skipping it - resolveAccount refuses an inactive account before the
    // cutoff is read at all.
    const reset = serverAction("resetStaffPassword");

    assert.match(reset, /CASE WHEN "active" THEN/);
    assert.match(reset, /ELSE "accessEndedAt" END/);
  });

  it("guards every raw write of the cutoff on the account being active", () => {
    // The third door. Deactivation guards it in the WHERE, the reset guards it
    // in the SET, and a future action that stamps it unguarded would move the
    // one number the access record exists to make trustworthy. Whole statements
    // rather than the whole file, so one guarded writer cannot vouch for
    // another.
    const statements = read(serverActions)
      .split(/UPDATE "User"/)
      .slice(1)
      .map((tail) => tail.split("`")[0]);

    const cutoffWriters = statements.filter((statement) => /"accessEndedAt" =/.test(statement));

    assert.ok(cutoffWriters.length > 0, "expected raw updates that write the cutoff");

    for (const statement of cutoffWriters) {
      const guarded =
        /WHERE[\s\S]*"active" = true/.test(statement) ||
        /"accessEndedAt" = CASE WHEN "active" THEN/.test(statement);

      assert.ok(guarded, `this write of the cutoff is not guarded on "active":\n${statement}`);
    }
  });

  it("does not report a reset that wrote to no row", () => {
    // prisma.user.update raised on a missing row; raw SQL returns zero. An
    // admin told nothing would conclude they had reset a password they had not,
    // and the audit log would carry a row for a reset that never happened.
    assert.match(serverAction("resetStaffPassword"), /if \(changed === 0\) \{\s*throw new Error/);
  });

  it("tells an admin who reset their own password why they were signed out", () => {
    // Nothing stops an admin selecting themselves, and the cutoff ends the
    // session they pressed the button with. Correct, but it must not arrive as
    // a bare login page on their next click with nothing connecting the two.
    assert.match(
      serverAction("resetStaffPassword"),
      /if \(targetUserId === user\.id\) \{\s*redirect\(`\/login\?reason=\$\{PASSWORD_CHANGED_REASON\}`\)/,
    );

    // And the login page has to render that reason, or the redirect says
    // nothing the person can read.
    const loginPage = read(join("src", "app", "(auth)", "login", "page.tsx"));

    assert.match(loginPage, /PASSWORD_CHANGED_REASON/);
    assert.match(loginPage, /Your password was changed/);
  });
});
