import { UNSAFE_NAMES } from '@tsh/ddl-schema/workflow-contract';
import { isPlainObject } from '../../../utils/is-plain-object';

/** The select value standing for "not set". */
export const UNSET = '';

export function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

/** A copy of the object with one member set, or dropped when `member` is `undefined`; any key is an own key, `__proto__` too. */
export function setMember(
  object: Record<string, unknown>,
  key: string,
  member: unknown,
): Record<string, unknown> {
  const entries = Object.entries(object).flatMap(([current, value]): [string, unknown][] => {
    if (current !== key) return [[current, value]];
    return member === undefined ? [] : [[current, member]];
  });
  if (member !== undefined && !Object.hasOwn(object, key)) entries.push([key, member]);
  return Object.fromEntries(entries);
}

/** Why `name` cannot key an entry of a map, or `null` when it can. */
export function findEntryNameProblem(
  label: string,
  name: string,
  taken: readonly string[],
  pattern: string | undefined,
): string | null {
  if (name === '') return `${label} is required`;
  if (UNSAFE_NAMES.includes(name)) return `“${name}” is a reserved name`;
  if (taken.includes(name)) return `“${name}” is already used`;
  if (pattern !== undefined && !new RegExp(pattern).test(name)) {
    return `${label} must match ${pattern}`;
  }
  return null;
}

/** A scalar engine default as placeholder text, e.g. `default: documentType`. */
export function describeFallback(fallback: unknown): string | undefined {
  if (typeof fallback === 'string' || typeof fallback === 'number') return `default: ${fallback}`;
  if (typeof fallback === 'boolean') return `default: ${fallback ? 'yes' : 'no'}`;
  return undefined;
}

/** A copy of the object with one key renamed in place, so the entry keeps its position. */
export function renameMember(
  object: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object).map(([key, member]) => [key === from ? to : key, member]),
  );
}

/** An empty number box is an unset value, not zero. */
export function parseNumberInput(text: string): number | undefined {
  return text === '' ? undefined : Number(text);
}
