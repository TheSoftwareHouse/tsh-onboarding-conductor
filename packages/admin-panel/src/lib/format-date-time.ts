export const NOT_SET = '-';
const INVALID_DATE = 'Invalid date';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? INVALID_DATE : DATE_TIME_FORMATTER.format(date);
}

const LOG_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The audit table's `Occurred` cell: seconds precision, and the year kept — the trail spans arbitrary history, so a yearless timestamp is ambiguous. */
export function formatLogDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? INVALID_DATE : LOG_DATE_TIME_FORMATTER.format(date);
}

const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Calendar date only: uses a fixed month table because `Intl`'s en-GB `month: 'short'` renders September as "Sept". */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return INVALID_DATE;
  }
  return `${date.getDate()} ${SHORT_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatNullableDateTime(value: string | null): string {
  return value === null ? NOT_SET : formatDateTime(value);
}

export function formatNullableText(value: string | null): string {
  return value === null ? NOT_SET : value;
}
