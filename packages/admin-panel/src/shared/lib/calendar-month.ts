/**
 * Month arithmetic and layout for the calendar the datetime controls are picked from. Every value
 * here is local wall-clock time, matching the `datetime-local` control the calendar writes to.
 */

/** Weeks start on Monday, as they do in the `en-GB` formatting the panel reads dates in. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Weeks a month grid always draws, so browsing months never resizes the calendar under the pointer. */
const WEEKS_IN_GRID = 6;

const DAYS_IN_WEEK = WEEKDAY_LABELS.length;

const MONTH_TITLE_FORMATTER = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Steps whole months, clamping to the last day of a shorter month rather than spilling into it. */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();

  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

export function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function isSameMonth(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

/**
 * The grid one month is drawn as: its own days in place, and null wherever a cell belongs to a
 * neighbouring month. Days from other months are left blank rather than drawn faintly, so the
 * month being read has an unmistakable outline.
 */
export function buildMonthDays(month: Date): readonly (Date | null)[] {
  const first = startOfMonth(month);
  // getDay() counts from Sunday; the grid counts from Monday.
  const leading = (first.getDay() + 6) % DAYS_IN_WEEK;
  const dayCount = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

  return Array.from({ length: WEEKS_IN_GRID * DAYS_IN_WEEK }, (_unused, cell) => {
    const dayOfMonth = cell - leading + 1;

    return dayOfMonth >= 1 && dayOfMonth <= dayCount
      ? new Date(first.getFullYear(), first.getMonth(), dayOfMonth)
      : null;
  });
}

/** The month the calendar header names, such as "August 2026". */
export function formatMonthTitle(month: Date): string {
  return MONTH_TITLE_FORMATTER.format(month);
}

/** A day cell's accessible name, since its own text is only the number. */
export function formatDayLabel(day: Date): string {
  return DAY_LABEL_FORMATTER.format(day);
}
