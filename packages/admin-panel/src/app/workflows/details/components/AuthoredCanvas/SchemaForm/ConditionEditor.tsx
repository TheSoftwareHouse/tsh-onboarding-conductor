// PoC (throwaway): the engine's condition grammar as one sentence per row. Negation lives in the
// operator ("does not equal", "is not set", "none of"), so `not` never appears as a mode of its own;
// the saved JSON is still the engine's `{ not: … }`.
import type { ReactElement } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { FIELD_NAMES_LIST_ID } from './schema-utils';

type Condition = Record<string, unknown>;

const SUBJECTS = {
  field: 'Field',
  score: 'Score',
  all: 'All of',
  any: 'Any of',
  none: 'None of',
} as const;
type Subject = keyof typeof SUBJECTS;

const FIELD_OPERATORS = {
  equals: 'equals',
  notEquals: 'does not equal',
  in: 'is one of',
  notIn: 'is not one of',
  isSet: 'is set',
  isNotSet: 'is not set',
} as const;
type FieldOperator = keyof typeof FIELD_OPERATORS;

const SCORE_OPERATORS = { gte: '≥', gt: '>', lte: '≤', lt: '<' } as const;
type ScoreOperator = keyof typeof SCORE_OPERATORS;

const INPUT =
  'min-w-0 border border-border-strong bg-tsh-white px-2 py-1 text-body-sm disabled:bg-bg-subtle';

const asCondition = (value: unknown): Condition =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Condition) : {};

/** How a stored condition reads: what it tests, the operator, and the comparison it wraps. */
function readCondition(value: unknown): {
  subject: Subject;
  operator: FieldOperator | null;
  base: Condition;
} {
  const condition = asCondition(value);
  if ('all' in condition) return { subject: 'all', operator: null, base: condition };
  if ('any' in condition) return { subject: 'any', operator: null, base: condition };
  if ('score' in condition) return { subject: 'score', operator: null, base: condition };
  if ('not' in condition) {
    const inner = asCondition(condition.not);
    if ('any' in inner) return { subject: 'none', operator: null, base: inner };
    if ('field' in inner && 'equals' in inner) {
      return { subject: 'field', operator: 'notEquals', base: inner };
    }
    if ('field' in inner && 'in' in inner) {
      return { subject: 'field', operator: 'notIn', base: inner };
    }
    if ('field' in inner && 'isSet' in inner) {
      return {
        subject: 'field',
        operator: inner.isSet === false ? 'isSet' : 'isNotSet',
        base: inner,
      };
    }
    // Any other negation (not all, not score) has no sentence form, so it reads as "None of" one row.
    return { subject: 'none', operator: null, base: { any: [inner] } };
  }
  if ('in' in condition) return { subject: 'field', operator: 'in', base: condition };
  if ('isSet' in condition) {
    return {
      subject: 'field',
      operator: condition.isSet === false ? 'isNotSet' : 'isSet',
      base: condition,
    };
  }
  return { subject: 'field', operator: 'equals', base: condition };
}

/** A field comparison back to the engine's grammar, wrapping the negated operators in `not`. */
function writeFieldCondition(field: string, operator: FieldOperator, value: unknown): Condition {
  const list = Array.isArray(value) ? value : [value ?? ''];
  switch (operator) {
    case 'equals':
      return { field, equals: value ?? '' };
    case 'notEquals':
      return { not: { field, equals: value ?? '' } };
    case 'in':
      return { field, in: list };
    case 'notIn':
      return { not: { field, in: list } };
    case 'isSet':
      return { field, isSet: true };
    case 'isNotSet':
      return { field, isSet: false };
  }
}

function buildSubject(subject: Subject, field: string): Condition {
  switch (subject) {
    case 'field':
      return { field, isSet: true };
    case 'score':
      return { score: '', gte: 0 };
    case 'all':
      return { all: [{ field, isSet: true }] };
    case 'any':
      return { any: [{ field, isSet: true }] };
    case 'none':
      return { not: { any: [{ field, isSet: true }] } };
  }
}

function writeGroup(subject: Subject, items: unknown[]): Condition {
  if (subject === 'all') return { all: items };
  if (subject === 'any') return { any: items };
  return { not: { any: items } };
}

const GROUP_HINTS: Partial<Record<Subject, string>> = {
  all: 'every condition below holds',
  any: 'at least one holds',
  none: 'none of them hold',
};

/** A typed value back to JSON: `true`, `false` and numbers become themselves, the rest stays text. */
function parseScalar(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.trim() !== '' && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

export interface ConditionEditorProps {
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}

export function ConditionEditor({ value, onChange, readOnly }: ConditionEditorProps): ReactElement {
  const { subject, operator, base } = readCondition(value);
  const field = typeof base.field === 'string' ? base.field : '';
  const groupItems = subject === 'all' ? base.all : base.any;
  const hint = GROUP_HINTS[subject];

  return (
    <div className="flex flex-col gap-1.5">
      {/* Two columns: what is tested beside its subject, then the comparison beside its value. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
        <select
          className={INPUT}
          disabled={readOnly}
          value={subject}
          aria-label="Condition type"
          onChange={(event) => onChange(buildSubject(event.target.value as Subject, field))}
        >
          {Object.entries(SUBJECTS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {subject === 'field' && operator !== null && (
          <FieldComparison
            field={field}
            operator={operator}
            compared={'in' in base ? base.in : base.equals}
            readOnly={readOnly}
            onChange={onChange}
          />
        )}
        {subject === 'score' && (
          <ScoreComparison condition={base} onChange={onChange} readOnly={readOnly} />
        )}
        {hint !== undefined && (
          <Typography variant="meta" as="span">
            {hint}
          </Typography>
        )}
      </div>
      {hint !== undefined && (
        <ConditionList
          items={Array.isArray(groupItems) ? groupItems : []}
          joiner={subject === 'all' ? 'and' : 'or'}
          readOnly={readOnly}
          onChange={(items) => onChange(writeGroup(subject, items))}
        />
      )}
    </div>
  );
}

interface FieldComparisonProps {
  field: string;
  operator: FieldOperator;
  compared: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}

function FieldComparison({
  field,
  operator,
  compared,
  readOnly,
  onChange,
}: FieldComparisonProps): ReactElement {
  const takesValue = operator !== 'isSet' && operator !== 'isNotSet';
  const isList = operator === 'in' || operator === 'notIn';
  const text = Array.isArray(compared)
    ? compared.map(String).join(', ')
    : compared === undefined
      ? ''
      : String(compared);

  return (
    <>
      <input
        className={cn(INPUT, 'w-full font-mono')}
        list={FIELD_NAMES_LIST_ID}
        placeholder="field"
        aria-label="Field"
        disabled={readOnly}
        value={field}
        onChange={(event) => onChange(writeFieldCondition(event.target.value, operator, compared))}
      />
      <select
        className={INPUT}
        disabled={readOnly}
        value={operator}
        aria-label="Operator"
        onChange={(event) =>
          onChange(writeFieldCondition(field, event.target.value as FieldOperator, compared))
        }
      >
        {Object.entries(FIELD_OPERATORS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {takesValue && (
        <input
          className={cn(INPUT, 'w-full font-mono')}
          placeholder={isList ? 'A, B' : 'value'}
          aria-label="Value"
          disabled={readOnly}
          value={text}
          onChange={(event) => {
            const next = isList
              ? event.target.value.split(',').map((part) => parseScalar(part.trim()))
              : parseScalar(event.target.value);
            onChange(writeFieldCondition(field, operator, next));
          }}
        />
      )}
    </>
  );
}

interface ScoreComparisonProps {
  condition: Condition;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}

function ScoreComparison({ condition, onChange, readOnly }: ScoreComparisonProps): ReactElement {
  const operator =
    (Object.keys(SCORE_OPERATORS) as ScoreOperator[]).find((key) => key in condition) ?? 'gte';
  const threshold = typeof condition[operator] === 'number' ? (condition[operator] as number) : 0;

  return (
    <>
      <input
        className={cn(INPUT, 'w-full font-mono')}
        placeholder="score"
        aria-label="Score"
        disabled={readOnly}
        value={String(condition.score ?? '')}
        onChange={(event) => onChange({ score: event.target.value, [operator]: threshold })}
      />
      <select
        className={INPUT}
        disabled={readOnly}
        value={operator}
        aria-label="Comparison"
        onChange={(event) => onChange({ score: condition.score, [event.target.value]: threshold })}
      >
        {Object.entries(SCORE_OPERATORS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <input
        type="number"
        className={cn(INPUT, 'w-full')}
        aria-label="Threshold"
        disabled={readOnly}
        value={threshold}
        onChange={(event) =>
          onChange({ score: condition.score, [operator]: Number(event.target.value) })
        }
      />
    </>
  );
}

interface ConditionListProps {
  items: unknown[];
  /** The word between rows: "and" for All of, "or" for Any of and None of. */
  joiner: string;
  onChange: (items: unknown[]) => void;
  readOnly: boolean;
}

function ConditionList({ items, joiner, onChange, readOnly }: ConditionListProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-tsh-yellow-500 pl-2">
      {items.map((item, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          {index > 0 && (
            <Typography variant="caps-tiny" as="span" className="text-fg-4">
              {joiner}
            </Typography>
          )}
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <ConditionEditor
                value={item}
                readOnly={readOnly}
                onChange={(next) =>
                  onChange(items.map((current, at) => (at === index ? next : current)))
                }
              />
            </div>
            {!readOnly && items.length > 1 && (
              <button
                type="button"
                aria-label="Remove condition"
                className="cursor-pointer p-1 text-fg-4 hover:text-tsh-red"
                onClick={() => onChange(items.filter((_, at) => at !== index))}
              >
                ×
              </button>
            )}
          </div>
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="cursor-pointer self-start border border-dashed border-border-strong px-2 py-0.5 text-caption text-fg-3"
          onClick={() => onChange([...items, { field: '', isSet: true }])}
        >
          + Add condition
        </button>
      )}
    </div>
  );
}
