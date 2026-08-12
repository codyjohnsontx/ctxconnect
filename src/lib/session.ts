import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type SessionUser = Session["user"];

/**
 * Signed-out and deactivated both land on the login page, but only the second
 * one needs explaining: the person was working a moment ago and did nothing
 * wrong, and signing in again would only tell them their password is invalid.
 */
export const INACTIVE_ACCOUNT_REASON = "inactive";

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
    },
  });

  if (!account?.active) {
    return null;
  }

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
 * behind it is gone, or it has been deactivated. Every authenticated entry
 * point - page, server action and route handler - resolves the person here.
 */
export async function getActiveSessionUser(): Promise<SessionUser | null> {
  return resolveAccount(await getServerSession(authOptions));
}

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
