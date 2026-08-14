/**
 * The rule that decides whether a session survives a deactivation, kept apart
 * from src/lib/session.ts so it can be tested without a database.
 */

/**
 * True when this session cannot be shown to have been minted after the moment
 * the account last lost access.
 *
 * Deactivation has to reach the phone as well as the laptop, and a server
 * render cannot clear a cookie on a device that is not currently asking for
 * anything. So the cutoff lives on the account and every device is measured
 * against it: a session older than the cutoff is refused wherever it turns up,
 * including after the account is switched back on.
 *
 * `signedInAt` is stamped once, at sign-in, rather than read from the token's
 * own `iat`, which moves forward as NextAuth re-encodes the cookie.
 *
 * A session carrying no `signedInAt` at all is refused outright, whether or not
 * the account has a cutoff. Those sessions were minted before the claim
 * existed, so they hold no evidence of when they began, and the alternative -
 * backfilling a cutoff onto every already-inactive account - would mean writing
 * an "Access ended" time nobody can defend onto the one screen built to be
 * trusted. Refusing what cannot be proven costs every staff member a single
 * sign-in, once, on the deploy that ships this. Guessing would cost the record
 * its meaning permanently.
 *
 * The comparison is `<=`, so a session minted at exactly the cutoff instant is
 * refused rather than kept. The two values reach this function through
 * different roundings - epoch milliseconds on one side, a `TIMESTAMP(3)` column
 * on the other - so a sign-in and a deactivation inside the same millisecond
 * can tie, and a tie in a check like this one resolves against access.
 *
 * The design that would not need any of this is a generation counter on the
 * account, stamped into the token at sign-in and incremented on deactivation:
 * integer equality has no clock, no skew and no rounding. See the PRD - it is
 * recorded there as the thing to build if this ever genuinely matters, rather
 * than built now for a sub-millisecond artefact.
 */
export function sessionCannotBeProvenCurrent(
  signedInAt: number | null | undefined,
  accessEndedAt: Date | null,
) {
  if (typeof signedInAt !== "number") {
    return true;
  }

  if (!accessEndedAt) {
    return false;
  }

  return signedInAt <= accessEndedAt.getTime();
}
