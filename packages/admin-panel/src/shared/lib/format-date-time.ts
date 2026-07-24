const NOT_SET = '-';
const INVALID_DATE = 'Invalid date';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? INVALID_DATE : DATE_TIME_FORMATTER.format(date);
}

export function formatNullableDateTime(value: string | null): string {
  return value === null ? NOT_SET : formatDateTime(value);
}

export function formatNullableText(value: string | null): string {
  return value === null ? NOT_SET : value;
}
