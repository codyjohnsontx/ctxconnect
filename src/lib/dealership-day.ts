/**
 * When the dealership's day ends, for the two surfaces that have to answer "is
 * this follow-up due today?" with nobody to ask.
 *
 * A due date is stored as an instant, and an instant only becomes a day once
 * something picks a timezone to read it in. Reading it in the server's timezone
 * is the bug this module exists to close: on Vercel the server stands in UTC,
 * so a follow-up an advisor set for 8pm Central lands after midnight UTC and
 * drops out of "due today" - both the Command Center metric and the alert sweep
 * that raises `FOLLOW_UP_DUE`.
 *
 * The day belongs to the **dealership**, not to the server and not to whichever
 * device is reading. Two reasons. The sweep runs from a cron with no viewer at
 * all, so it needs an answer that does not depend on one. And a dealership is
 * one physical store where every advisor shares one working day: an advisor
 * whose laptop is still set to the zone she flew in from should see her store's
 * board, not her laptop's. What the *viewer's* clock does own is the printed
 * moment - that is `LocalTimestamp`, and it is a different question.
 *
 * The printed moment and the day boundary can therefore disagree by design, and
 * that is correct: she reads a follow-up in her own time and the store counts it
 * on the store's day.
 */

const DEFAULT_TIME_ZONE = "America/Chicago";

/**
 * The IANA zone the dealership keeps its day in. Configuration rather than a
 * stored setting: Attend serves one dealership, and a column would need a
 * migration and a settings screen to say something that does not change.
 */
export function dealershipTimeZone() {
  return process.env.DEALERSHIP_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  const cached = formatters.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // h23 rather than hour12: false, which renders midnight as hour 24 on some
    // runtimes and would push every boundary a day out.
    hourCycle: "h23",
  });

  formatters.set(timeZone, formatter);

  return formatter;
}

/** The wall clock `timeZone` is showing at `instant`. */
function wallClockAt(instant: Date, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** How far ahead of UTC `timeZone` is at `instant`, in milliseconds. */
function offsetAt(instant: Date, timeZone: string) {
  const wall = wallClockAt(instant, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    instant.getUTCMilliseconds(),
  );

  return asUtc - instant.getTime();
}

/**
 * The last instant of the dealership's day containing `now`.
 *
 * The offset is read twice because the one in force at the end of the day is
 * not always the one in force now - the clocks can change in between, and a
 * single reading is an hour wrong on those two days a year.
 */
export function endOfDealershipDay(now: Date, timeZone = dealershipTimeZone()) {
  const { year, month, day } = wallClockAt(now, timeZone);
  const lastWallMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const guess = new Date(lastWallMs - offsetAt(now, timeZone));

  return new Date(lastWallMs - offsetAt(guess, timeZone));
}
