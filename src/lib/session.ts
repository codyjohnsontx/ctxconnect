import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionCannotBeProvenCurrent } from "@/lib/session-cutoff";

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
 * Marks the account as having been granted a request.
 *
 * Only granted requests count, and the write carries `active: true` in its own
 * WHERE rather than trusting the read that happened a moment ago. An admin can
 * deactivate the account in the gap between that read and this write, and a
 * plain write by id would then stamp a timestamp *later* than the cutoff - the
 * access record would show the person working after their access ended, which
 * is the one number Part 3 exists to make trustworthy. Deactivation sets
 * `active: false` and `accessEndedAt` in a single update, so the two statements
 * serialize: either this one lands first, or it matches no rows and is skipped.
 *
 * Skipping is the correct outcome, not a failure, and neither a skip nor a
 * database error may break a request whose access was already decided.
 */
async function recordLastSeen(userId: string, lastSeenAt: Date | null) {
  const now = Date.now();

  if (lastSeenAt && now - lastSeenAt.getTime() < LAST_SEEN_INTERVAL_MS) {
    return;
  }

  try {
    // updateMany rather than update: this deliberately matches no rows when the
    // account has just been switched off or deleted, and update would throw.
    await prisma.user.updateMany({
      where: { id: userId, active: true },
      data: { lastSeenAt: new Date(now) },
    });
  } catch (error) {
    console.error("Failed to record a granted request against an account.", { userId, error });
  }
}

/**
 * Whether anyone is signed in, and when nobody is, whether that is because the
 * account itself is switched off. The two refusals are not the same sentence to
 * the person reading them.
 */
type Resolution =
  | { user: SessionUser; accountInactive: false }
  | { user: null; accountInactive: boolean };

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
async function resolveAccount(session: Session | null): Promise<Resolution> {
  if (!session?.user?.id) {
    return { user: null, accountInactive: false };
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

  // A deleted row is treated as a deactivated one: from the outside they are
  // the same event, and a session can outlive a row removed outside the app.
  if (!account?.active) {
    return { user: null, accountInactive: true };
  }

  // The account is live; only this particular session is too old to trust.
  if (sessionCannotBeProvenCurrent(session.user.signedInAt, account.accessEndedAt)) {
    return { user: null, accountInactive: false };
  }

  await recordLastSeen(account.id, account.lastSeenAt);

  return {
    user: {
      ...session.user,
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      department: account.department,
    },
    accountInactive: false,
  };
}

/**
 * The signed-in staff member, or null when there is no session, the account
 * behind it is gone, has been deactivated, or the session cannot be shown to
 * postdate the moment it was switched off. Route handlers and the login page
 * resolve here; pages and server actions use requireUser.
 */
export async function getActiveSessionUser(): Promise<SessionUser | null> {
  return (await resolveAccount(await getServerSession(authOptions))).user;
}

/**
 * The signed-in staff member, or the login page.
 *
 * Used by every page and every server action, so a form submitted from a tab
 * that was open when the account was switched off lands on the same notice a
 * page load does rather than on Next's raw error screen. Someone who was just
 * let go should read one quiet sentence, not a stack of framework text.
 *
 * Only an account that really is switched off gets that sentence. A session
 * refused for being older than a cutoff on a live account - the advisor
 * deactivated by mistake at 01:00 and put back at 01:10 - lands on a plain
 * login page instead, because telling her the account is inactive would be
 * telling her something untrue.
 */
export async function requireUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { user, accountInactive } = await resolveAccount(session);

  if (!user) {
    redirect(accountInactive ? `/login?reason=${INACTIVE_ACCOUNT_REASON}` : "/login");
  }

  return user;
}
