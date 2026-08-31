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

/** A `datetime-local` input value for `date`, read in local time. */
export function toDateTimeLocalValue(date: Date) {
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

  return toDateTimeLocalValue(atOpening(now, 1));
}

function atOpening(now: Date, daysAhead: number) {
  const day = new Date(now);
  day.setDate(day.getDate() + daysAhead);
  day.setHours(OPENING_HOUR, 0, 0, 0);

  return day;
}

/**
 * The one-click dates offered when a follow-up has to move. A plan almost
 * always slips by a day or by a week - "call me when I'm back Monday" - and
 * making her operate a date picker for the two common answers is how a
 * follow-up ends up marked done instead of moved.
 *
 * Both land at opening time, because the hour she happens to be standing at the
 * counter is not an hour she will be reading her queue.
 */
export function followUpSnoozeOptions(now: Date) {
  return [
    { label: "Tomorrow", value: toDateTimeLocalValue(atOpening(now, 1)) },
    { label: "In a week", value: toDateTimeLocalValue(atOpening(now, 7)) },
  ];
}

const DATE_TIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const ZONED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The instant a `datetime-local` value names, read in the timezone of whoever
 * calls it. Null for anything that is not a bare wall-clock value.
 *
 * The advisor picks a wall clock in her own timezone; the server that stores it
 * is somewhere else, UTC on Vercel. So the reading has to happen in the browser,
 * where the timezone is actually known, and what crosses the wire has to carry
 * its offset. Handing a server action "2026-08-31T17:00" instead gets it read
 * wherever the server is standing, which is how a follow-up set for closing
 * time lands at lunchtime.
 *
 * Refusing an already-zoned string is what makes that a rule rather than a
 * convention: this can only ever be given the picker's own output.
 */
export function instantFromDateTimeLocal(value: string): Date | null {
  if (!DATE_TIME_LOCAL.test(value)) {
    return null;
  }

  const instant = new Date(value);

  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * The other end of that trip: an instant as it arrives at a server action. Null
 * unless the string names its offset, so a bare local value cannot reach a
 * write and be read in the server's timezone instead of hers.
 */
export function instantFromZonedIso(value: string): Date | null {
  if (!ZONED_INSTANT.test(value)) {
    return null;
  }

  const instant = new Date(value);

  return Number.isNaN(instant.getTime()) ? null : instant;
}
