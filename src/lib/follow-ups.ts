/**
 * Pure helpers shared by the AI ops brief panel and the create-follow-up form.
 * They live outside the components because the duplicate check has to agree
 * with what the "Open follow-ups" list already shows the advisor, and because
 * the due-date default is easier to trust with a test than with a screenshot.
 */

/**
 * Collapses a follow-up title to the words it is made of, so titles that only
 * differ in case, punctuation, or spacing compare equal. "Offer Kelsey two
 * first-service slots" and "Offer Kelsey two first service slots." both reduce
 * to "offer kelsey two first service slots".
 */
export function normalizeFollowUpTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Returns the open follow-up that already covers `title`, or null. Only exact
 * word-for-word repeats are caught: a follow-up phrased differently but meaning
 * the same thing still gets through, and that is the advisor's call to make.
 */
export function findMatchingFollowUp<T extends { title: string }>(
  title: string | null | undefined,
  openFollowUps: readonly T[],
): T | null {
  const target = normalizeFollowUpTitle(title ?? "");

  if (!target) {
    return null;
  }

  return openFollowUps.find((followUp) => normalizeFollowUpTitle(followUp.title) === target) ?? null;
}

const CLOSING_HOUR = 17;
const OPENING_HOUR = 9;
const MIN_LEAD_MS = 2 * 60 * 60 * 1000;

function toDateTimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

/**
 * The due date a new follow-up starts on, as a `datetime-local` value: the end
 * of today when that is still at least two hours out, otherwise tomorrow
 * morning. An advisor acting on a brief wants the follow-up on the board, not a
 * date picker, and every default lands inside working hours she can hit.
 */
export function defaultFollowUpDueDate(now: Date) {
  const endOfToday = new Date(now);
  endOfToday.setHours(CLOSING_HOUR, 0, 0, 0);

  if (endOfToday.getTime() - now.getTime() >= MIN_LEAD_MS) {
    return toDateTimeLocalValue(endOfToday);
  }

  const nextMorning = new Date(now);
  nextMorning.setDate(nextMorning.getDate() + 1);
  nextMorning.setHours(OPENING_HOUR, 0, 0, 0);

  return toDateTimeLocalValue(nextMorning);
}
