// Converts "today" in an arbitrary IANA timezone into a UTC instant range,
// so the DB (which only ever stores UTC timestamps) can be queried with a
// plain >= / < comparison. This is the one piece of TZ-aware logic in the
// service — everything else deals in UTC only.

export class InvalidTimezoneError extends Error {}

function assertValidTimezone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new InvalidTimezoneError(`Invalid IANA timezone: ${timeZone}`);
  }
}

function getOffsetMinutes(utcInstant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcInstant);

  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;

  const wallClockAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  // Real-world UTC offsets are always a whole number of minutes; rounding
  // guards against `utcInstant` carrying sub-second milliseconds (the
  // normal case for `new Date()`) turning this into a fractional value,
  // which would otherwise leak a few hundred ms of drift into every
  // downstream midnight-boundary calculation.
  return Math.round((wallClockAsUtc - utcInstant.getTime()) / 60_000);
}

// The caller's own local calendar date (e.g. "2026-09-15"), used to bucket
// "All" by visitor-day the same way getTodayUtcRange buckets "Today" -- by
// the caller's real local day, not the server's UTC day. Deriving this from
// UTC alone (e.g. `isoString.slice(0, 10)`) is wrong for any timezone ahead
// of UTC: a visit made just after local midnight can still fall on the
// previous UTC calendar day, silently swallowing a same-day return visit
// into the day before.
export function getLocalDateString(
  timeZone: string,
  now: Date = new Date(),
): string {
  assertValidTimezone(timeZone);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;

  return `${map.year}-${map.month}-${map.day}`;
}

export function getTodayUtcRange(
  timeZone: string,
  now: Date = new Date(),
): { start: Date; end: Date } {
  assertValidTimezone(timeZone);

  const offsetAtNow = getOffsetMinutes(now, timeZone);
  const localNow = new Date(now.getTime() + offsetAtNow * 60_000);
  const localMidnightAsUtc = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
    0,
    0,
    0,
  );

  // Re-derive the offset at the candidate start instant in case of a DST
  // transition between "now" and local midnight.
  const startGuess = new Date(localMidnightAsUtc - offsetAtNow * 60_000);
  const offsetAtStart = getOffsetMinutes(startGuess, timeZone);
  const start = new Date(localMidnightAsUtc - offsetAtStart * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}
