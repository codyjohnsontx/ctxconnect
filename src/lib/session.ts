import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionPredatesCutoff } from "@/lib/session-cutoff";

export type SessionUser = Session["user"];

/**
 * Signed-out and deactivated both land on the login page, but only the second
 * one needs explaining: the person was working a moment ago and did nothing
 * wrong, and signing in again would only tell them their password is invalid.
 */
export const INACTIVE_ACCOUNT_REASON = "inactive";

/**
 * How stale `lastSeenAt` is allowed to get. Every authenticated request would
 * otherwise write to the row it just read; a minute is precise enough to tell
 * an admin whether someone was working when access ended.
 */
const LAST_SEEN_INTERVAL_MS = 60_000;

/**
 * Marks the account as seen on a request that was granted.
 *
 * Only granted requests count. A refused one would push the timestamp past the
 * moment access ended and make a cut-off account look like it was still
 * working, which is the opposite of what the admin reading it needs.
 */
async function recordLastSeen(userId: string, lastSeenAt: Date | null) {
  const now = Date.now();

  if (lastSeenAt && now - lastSeenAt.getTime() < LAST_SEEN_INTERVAL_MS) {
    return;
  }

  // updateMany rather than update: the row can be deleted between the read and
  // this write, and a bookkeeping timestamp must not turn that into a crash.
  await prisma.user.updateMany({
    where: { id: userId },
    data: { lastSeenAt: new Date(now) },
  });
}

/**
 * Re-reads the account a session claims, so the database rather than the token
 * decides who is signed in.
 *
 * Sessions are JWTs, so the token keeps asserting an account, a role and a
 * department for its full 30-day life. Nothing re-checks the account after the
 * sign-in that minted it, so trusting the token alone lets a staff member an
 * admin has just deactivated keep reading customer threads and writing to them
 * for a month, and lets an account that no longer exists at all reach the
 * database and fail on a foreign key. Resolving here also means a role or
 * department change takes effect on the next request rather than the next
 * sign-in.
 *
 * An account switched back on does not resurrect the sessions it had when it
 * was switched off; those are older than its cutoff and stay refused.
 */
async function resolveAccount(session: Session | null): Promise<SessionUser | null> {
  if (!session?.user?.id) {
    return null;
  }

  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      department: true,
      active: true,
      accessEndedAt: true,
      lastSeenAt: true,
    },
  });

  if (!account?.active) {
    return null;
  }

  if (sessionPredatesCutoff(session.user.signedInAt, account.accessEndedAt)) {
    return null;
  }

  await recordLastSeen(account.id, account.lastSeenAt);

  return {
    ...session.user,
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    department: account.department,
  };
}

/**
 * The signed-in staff member, or null when there is no session, the account
 * behind it is gone, has been deactivated, or the session predates the moment
 * it was switched off. Route handlers and the login page resolve here; pages
 * and server actions use requireUser.
 */
export async function getActiveSessionUser(): Promise<SessionUser | null> {
  return resolveAccount(await getServerSession(authOptions));
}

/**
 * The signed-in staff member, or the login page.
 *
 * Used by every page and every server action, so a form submitted from a tab
 * that was open when the account was switched off lands on the same notice a
 * page load does rather than on Next's raw error screen. Someone who was just
 * let go should read one quiet sentence, not a stack of framework text.
 */
export async function requireUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await resolveAccount(session);

  if (!user) {
    redirect(`/login?reason=${INACTIVE_ACCOUNT_REASON}`);
  }

  return user;
}
