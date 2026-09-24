import { NOT_SET } from './format-date-time';

/** One audit metadata value as a single line: arrays joined, nested objects kept as JSON. */
export function formatAuditMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return NOT_SET;
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? NOT_SET : value.map(formatAuditMetadataValue).join(', ');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
