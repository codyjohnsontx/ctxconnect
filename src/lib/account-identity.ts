/**
 * How a signed-in account is named in a space too small for a full name.
 *
 * A dealership phone gets handed around, so the person holding it has to be
 * able to tell at a glance whose account is sending the texts. These helpers
 * are what the bottom navigation shows in one cell about 60px wide.
 */

const FALLBACK_NAME = "Account";
const FALLBACK_INITIALS = "?";

function words(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/).filter(Boolean);
}

/** Up to two letters for the avatar: "Alyssa Torres" -> "AT", "Cher" -> "C". */
export function accountInitials(name: string | null | undefined) {
  const parts = words(name);

  if (parts.length === 0) {
    return FALLBACK_INITIALS;
  }

  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";

  // Spread rather than indexed, so a name whose first letter is outside the
  // basic multilingual plane keeps its whole character instead of half of it.
  return `${[...first][0]}${last ? [...last][0] : ""}`.toUpperCase();
}

/**
 * The first name, because that is what fits and what a colleague would say.
 * A single-word name is used whole rather than trimmed to nothing.
 */
export function accountShortName(name: string | null | undefined) {
  return words(name)[0] ?? FALLBACK_NAME;
}

/** The full name, or something honest when the account has none stored. */
export function accountFullName(name: string | null | undefined) {
  return words(name).join(" ") || FALLBACK_NAME;
}
