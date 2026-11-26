import { isPlainObject } from './is-plain-object';

const CUSTOM = 'custom condition';

const SCORE_COMPARATORS = { gte: '≥', gt: '>', lte: '≤', lt: '<' } as const;

function formatLiteral(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
}

function describeChildren(children: unknown, joiner: string): string {
  if (!Array.isArray(children) || children.length === 0) return CUSTOM;
  return children
    .map((child) => {
      const text = describeNode(child);
      const compound = isPlainObject(child) && ('all' in child || 'any' in child);
      return compound && children.length > 1 ? `(${text})` : text;
    })
    .join(joiner);
}

function describeNode(when: unknown): string {
  if (!isPlainObject(when)) return CUSTOM;
  if ('all' in when) return describeChildren(when.all, ' and ');
  if ('any' in when) return describeChildren(when.any, ' or ');
  if ('not' in when) return `not (${describeNode(when.not)})`;

  if (typeof when.score === 'string') {
    for (const [key, symbol] of Object.entries(SCORE_COMPARATORS)) {
      if (typeof when[key] === 'number') return `score ${when.score} ${symbol} ${when[key]}`;
    }
    return CUSTOM;
  }

  if (typeof when.field !== 'string') return CUSTOM;
  if ('equals' in when) return `${when.field} = ${formatLiteral(when.equals)}`;
  if (Array.isArray(when.in)) return `${when.field} in ${when.in.map(formatLiteral).join(', ')}`;
  if (typeof when.isSet === 'boolean') {
    return `${when.field} is ${when.isSet ? 'set' : 'not set'}`;
  }
  return CUSTOM;
}

/** Renders a transition or field guard as one line; never throws on a malformed document. */
export function describeCondition(when: unknown): string {
  try {
    return describeNode(when);
  } catch {
    return CUSTOM;
  }
}
