import { ToolError } from '../tool-error';
import type { ToolArguments, ToolInputSchema } from '../tool-registration';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INSTANT_LENGTH = 64;

export interface IntegerRange {
  min: number;
  max: number;
}

export const POSITIVE_INTEGER: IntegerRange = { min: 1, max: Number.MAX_SAFE_INTEGER };

/** An inclusive range of instants; an open end is absent. */
export interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Refuses an argument the schema does not declare, so a misspelt filter cannot silently widen a
 * query. The registry applies it to every tool whose schema sets `additionalProperties: false`.
 */
export function assertKnownArguments(args: ToolArguments, inputSchema: ToolInputSchema): void {
  const known = Object.keys(inputSchema.properties ?? {});
  const unknown = Object.keys(args).filter((name) => !known.includes(name));

  if (unknown.length > 0) {
    throw new ToolError(
      `Unknown argument ${unknown.join(', ')}. This tool accepts: ${known.join(', ') || 'no arguments'}.`,
    );
  }
}

/** An optional text argument, trimmed; absent or `null` is `undefined`, anything blank is refused. */
export function findString(
  args: ToolArguments,
  name: string,
  maxLength?: number,
): string | undefined {
  const value = args[name];

  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '' || (maxLength && value.length > maxLength)) {
    throw new ToolError(
      maxLength === undefined
        ? `${name} must be a non-empty string.`
        : `${name} must be a non-empty text of at most ${maxLength} characters.`,
    );
  }

  return value.trim();
}

export function getString(args: ToolArguments, name: string): string {
  const value = findString(args, name);

  if (value === undefined) {
    throw new ToolError(`${name} is required and must be a non-empty string.`);
  }

  return value;
}

export function findBoolean(args: ToolArguments, name: string): boolean | undefined {
  const value = args[name];

  if (value !== undefined && typeof value !== 'boolean') {
    throw new ToolError(`${name} must be true or false.`);
  }

  return value;
}

function isIntegerIn(value: unknown, { min, max }: IntegerRange): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function describeRange({ min, max }: IntegerRange): string {
  return max === Number.MAX_SAFE_INTEGER ? `of ${min} or more` : `from ${min} to ${max}`;
}

export function findInteger(
  args: ToolArguments,
  name: string,
  range: IntegerRange = POSITIVE_INTEGER,
): number | undefined {
  const value = args[name];

  if (value === undefined) {
    return undefined;
  }
  if (!isIntegerIn(value, range)) {
    throw new ToolError(`${name} must be a whole number ${describeRange(range)}.`);
  }

  return value;
}

export function getInteger(
  args: ToolArguments,
  name: string,
  range: IntegerRange = POSITIVE_INTEGER,
): number {
  const value = args[name];

  if (!isIntegerIn(value, range)) {
    throw new ToolError(`${name} is required and must be a whole number ${describeRange(range)}.`);
  }

  return value;
}

export function findOneOf<T extends string>(
  args: ToolArguments,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = findString(args, name);

  if (value !== undefined && !allowed.includes(value as T)) {
    throw new ToolError(`${name} must be one of: ${allowed.join(', ')}.`);
  }

  return value as T | undefined;
}

/**
 * An ISO-8601 date or date-time. A date alone covers its whole UTC day: as a start it is the
 * day's first instant, as an end its last.
 */
export function findInstant(
  args: ToolArguments,
  name: string,
  edge: 'start' | 'end',
): Date | undefined {
  const value = findString(args, name, MAX_INSTANT_LENGTH);

  if (value === undefined) {
    return undefined;
  }

  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new ToolError(`${name} must be an ISO-8601 date (2026-10-31) or date-time.`);
  }

  if (edge === 'end' && DATE_ONLY_PATTERN.test(value)) {
    instant.setUTCDate(instant.getUTCDate() + 1);
    instant.setUTCMilliseconds(-1);
  }

  return instant;
}

export function findDateRange(args: ToolArguments, fromName: string, toName: string): DateRange {
  const from = findInstant(args, fromName, 'start');
  const to = findInstant(args, toName, 'end');

  if (from !== undefined && to !== undefined && from > to) {
    throw new ToolError(`${fromName} must not be later than ${toName}.`);
  }

  return { from, to };
}
