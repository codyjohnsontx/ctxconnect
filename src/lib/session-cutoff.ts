/**
 * The rule that decides whether a session survives a deactivation, kept apart
 * from src/lib/session.ts so it can be tested without a database.
 */

/**
 * True when this session was minted before the account was last switched off.
 *
 * Deactivation has to reach the phone as well as the laptop, and a server
 * render cannot clear a cookie on a device that is not currently asking for
 * anything. So the cutoff lives on the account and every device is measured
 * against it: a session older than the cutoff is refused wherever it turns up,
 * including after the account is switched back on.
 *
 * `signedInAt` is stamped once, at sign-in, rather than read from the token's
 * own `iat`, which moves forward as NextAuth re-encodes the cookie. A session
 * without it predates the claim, so it cannot be shown to be newer than the
 * cutoff and is refused too. The cost is one sign-in for anyone holding a
 * pre-upgrade session for an account that has since been reactivated.
 */
export function sessionPredatesCutoff(
  signedInAt: number | null | undefined,
  accessEndedAt: Date | null,
) {
  if (!accessEndedAt) {
    return false;
  }

  return typeof signedInAt !== "number" || signedInAt < accessEndedAt.getTime();
}
