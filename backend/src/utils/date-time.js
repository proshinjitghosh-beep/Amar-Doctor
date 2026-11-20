/**
 * Date/time helpers for reminder scheduling.
 *
 * Reminder times are stored as a wall-clock "HH:MM" plus an IANA timezone, so
 * a schedule keeps meaning 08:00 in Dhaka even when the server runs in UTC.
 * Occurrences are computed with Intl and persisted as UTC timestamps.
 */

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function parseReminderTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** "0,1,2,3,4,5,6" -> [0,1,2,3,4,5,6] (0 = Sunday). Invalid entries dropped. */
export function parseRepeatDays(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  const days = source
    .map((day) => Number(String(day).trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
}

export function formatRepeatDays(days) {
  return parseRepeatDays(days).join(',');
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl can emit hour "24" for midnight in some ICU versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) between UTC and the given zone at the given instant. */
function zoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the given wall-clock time occurs in `timeZone` on
 * the given local calendar date. Resolved iteratively because the offset
 * itself depends on the instant (DST boundaries).
 */
export function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = new Date(guess);
  for (let i = 0; i < 3; i += 1) {
    const offset = zoneOffsetMs(utc, timeZone);
    const next = new Date(guess - offset);
    if (next.getTime() === utc.getTime()) break;
    utc = next;
  }
  return utc;
}

/** Day-of-week (0 = Sunday) for a local calendar date. */
export function weekdayOf({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * All occurrences of a schedule between two instants (inclusive of `from`,
 * exclusive of `to`), as UTC timestamps.
 */
export function occurrencesBetween({ startAt, endAt, days, time, timeZone }) {
  const timeParts = parseReminderTime(time);
  if (!timeParts) return [];

  const repeatDays = parseRepeatDays(days);
  const results = [];

  // Walk local calendar days around the window, converting each to UTC.
  const from = new Date(startAt);
  const to = new Date(endAt);

  // Start one local day early so a UTC/local offset shift cannot drop the
  // first candidate occurrence.
  let cursor = new Date(from.getTime() - 36 * 60 * 60 * 1000);
  const limit = to.getTime() + 36 * 60 * 60 * 1000;

  while (cursor.getTime() <= limit) {
    const local = zonedParts(cursor, timeZone);
    const dayOfWeek = weekdayOf(local);
    if (repeatDays.includes(dayOfWeek)) {
      const occurrence = zonedTimeToUtc(
        { year: local.year, month: local.month, day: local.day, hour: timeParts.hour, minute: timeParts.minute },
        timeZone
      );
      if (occurrence.getTime() >= from.getTime() && occurrence.getTime() < to.getTime()) {
        results.push(occurrence);
      }
    }
    // Advance to the next local day by adding 24h of wall time and re-reading
    // the zone, which keeps the calendar walk correct across DST shifts.
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return results.sort((a, b) => a.getTime() - b.getTime());
}

/** "2024-01-05" -> Date at local midnight (UTC date parts only). */
export function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format an instant as "YYYY-MM-DD HH:MM" in the given zone. */
export function formatZoned(instant, timeZone = 'Asia/Dhaka') {
  const parts = zonedParts(new Date(instant), timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export const DAY_NAMES = WEEKDAY_INDEX;
