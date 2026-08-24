/**
 * Helpers for the `datetime-local` control value, which is wall-clock time in the operator's own
 * zone written as `YYYY-MM-DDTHH:mm` - never an instant, and never carrying an offset.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The control value naming the same wall-clock minute this instant falls on locally. Built from
 * the local date parts rather than from `toISOString`, which would name the UTC minute instead
 * and shift the value by the operator's offset.
 */
export function toDateTimeLocalValue(date: Date): string {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join('T');
}

/** Control value for the instant `minutes` before now, which is how every quick range is anchored. */
export function minutesAgoDateTimeLocalValue(minutes: number, now: Date = new Date()): string {
  return toDateTimeLocalValue(new Date(now.getTime() - minutes * 60_000));
}

/**
 * IANA zone the values are read in, shown beside the controls so a window is not mistaken for UTC.
 * Falls back to the empty string in an environment that cannot resolve one, which hides the hint.
 */
export function resolveLocalTimeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * The instant a control value names in the operator's own zone, or null when it names none.
 * `Date` parses this format as local time, which is exactly how the control means it.
 */
export function parseDateTimeLocalValue(value: string): Date | null {
  if (value.length === 0) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The date half of a control value, `YYYY-MM-DD`, taken from local date parts. */
export function toDateOnlyValue(date: Date): string {
  return toDateTimeLocalValue(date).slice(0, 10);
}

/** The time half of a control value, `HH:mm`, or the fallback when the value names no time. */
export function timeOfDayFromValue(value: string, fallback: string): string {
  const time = value.slice(11, 16);
  return time.length === 5 ? time : fallback;
}

/** A control value built from a chosen day and a chosen time of day. */
export function toDateTimeLocalValueParts(date: Date, timeOfDay: string): string {
  return `${toDateOnlyValue(date)}T${timeOfDay}`;
}
