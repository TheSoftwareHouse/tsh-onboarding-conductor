import { useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input/Input';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import {
  WORKFLOW_SCORE_COMPARATORS,
  type RawWorkflowCondition,
  type WorkflowConditionScalar,
  type WorkflowScoreComparator,
} from '@tsh/ddl-schema/workflow-contract';
import { DEFAULT_CONDITION, FIELD_NAMES_LIST_ID } from '../../../utils/config-schema';
import { asObject, parseNumberInput } from './form-values';

/** A stored condition as read back: whatever the document holds, probed key by key. */
type StoredCondition = Record<string, unknown>;

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

const SCORE_OPERATORS: Record<WorkflowScoreComparator, string> = {
  gte: '≥',
  gt: '>',
  lte: '≤',
  lt: '<',
};

const GROUP_HINTS: Partial<Record<Subject, string>> = {
  all: 'every condition below holds',
  any: 'at least one holds',
  none: 'none of them hold',
};

/** A control's accessible name, with the condition's path where conditions repeat. */
function nameControl(label: string, path: string | undefined): string {
  return path === undefined ? label : `${label} of condition ${path}`;
}

function listItems<Key extends string>(
  labels: Record<Key, string>,
): { value: Key; label: string }[] {
  return (Object.entries(labels) as [Key, string][]).map(([value, label]) => ({ value, label }));
}

const SUBJECT_ITEMS = listItems(SUBJECTS);
const FIELD_SUBJECT_ITEMS = SUBJECT_ITEMS.filter((item) => item.value !== 'score');
const FIELD_OPERATOR_ITEMS = listItems(FIELD_OPERATORS);
const SCORE_OPERATOR_ITEMS = listItems(SCORE_OPERATORS);

/** How a stored condition reads: what it tests, the operator, and the comparison it wraps. */
function readCondition(value: unknown): {
  subject: Subject;
  operator: FieldOperator | null;
  base: StoredCondition;
} {
  const condition = asObject(value);
  if ('all' in condition) return { subject: 'all', operator: null, base: condition };
  if ('any' in condition) return { subject: 'any', operator: null, base: condition };
  if ('score' in condition) return { subject: 'score', operator: null, base: condition };
  if ('not' in condition) {
    const inner = asObject(condition.not);
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

/** A list as one value: its only item, or empty when it holds several, which no single value can stand for. */
function toScalar(value: unknown): WorkflowConditionScalar {
  if (!Array.isArray(value)) return (value ?? '') as WorkflowConditionScalar;
  return (value.length === 1 ? value[0] : '') as WorkflowConditionScalar;
}

/** A field comparison back to the engine's grammar, wrapping the negated operators in `not`. */
function writeFieldCondition(
  field: string,
  operator: FieldOperator,
  value: unknown,
): RawWorkflowCondition {
  const scalar = toScalar(value);
  const list = (Array.isArray(value) ? value : [scalar]) as WorkflowConditionScalar[];
  switch (operator) {
    case 'equals':
      return { field, equals: scalar };
    case 'notEquals':
      return { not: { field, equals: scalar } };
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

function buildSubject(subject: Subject, field: string): RawWorkflowCondition {
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

function isGroup(subject: Subject): boolean {
  return subject === 'all' || subject === 'any' || subject === 'none';
}

function writeGroup(subject: Subject, items: RawWorkflowCondition[]): RawWorkflowCondition {
  if (subject === 'all') return { all: items };
  if (subject === 'any') return { any: items };
  return { not: { any: items } };
}

/** A typed value back to JSON: `true`, `false` and plain numbers become themselves, the rest (`01234` too) stays text. */
function parseScalar(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.trim() !== '' && String(Number(text)) === text) return Number(text);
  return text;
}

function formatCompared(compared: unknown): string {
  if (Array.isArray(compared)) return compared.map(String).join(', ');
  return compared === undefined ? '' : String(compared);
}

export interface ConditionEditorProps {
  value: unknown;
  onChange: (value: RawWorkflowCondition) => void;
  readOnly: boolean;
  /** Names the condition in its controls' accessible names where conditions repeat, such as "2.1". */
  path?: string;
  /** Off where the grammar has no score leaf (a scoring rule's `when`); a stored one still shows. */
  allowScore?: boolean;
}

/** The engine's condition grammar as one sentence per row; negation lives in the operator. */
export function ConditionEditor({
  value,
  onChange,
  readOnly,
  allowScore = true,
  path,
}: ConditionEditorProps): ReactElement {
  const { subject, operator, base } = readCondition(value);
  const field = typeof base.field === 'string' ? base.field : '';
  const groupItems = subject === 'all' ? base.all : base.any;
  const items = Array.isArray(groupItems) ? (groupItems as RawWorkflowCondition[]) : [];
  const hint = GROUP_HINTS[subject];

  return (
    <div className="flex flex-col gap-1.5">
      {/* Two columns: what is tested beside its subject, then the comparison beside its value. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
        <Select
          aria-label={nameControl('Condition type', path)}
          items={allowScore || subject === 'score' ? SUBJECT_ITEMS : FIELD_SUBJECT_ITEMS}
          value={subject}
          disabled={readOnly}
          className="w-auto"
          onValueChange={(next) =>
            // Between All, Any and None only the joiner changes, so the rows stay.
            onChange(
              isGroup(subject) && isGroup(next)
                ? writeGroup(next, items)
                : buildSubject(next, field),
            )
          }
        />
        {subject === 'field' && operator !== null && (
          <FieldComparison
            field={field}
            operator={operator}
            compared={'in' in base ? base.in : base.equals}
            readOnly={readOnly}
            path={path}
            onChange={onChange}
          />
        )}
        {subject === 'score' && (
          <ScoreComparison condition={base} onChange={onChange} readOnly={readOnly} path={path} />
        )}
        {hint !== undefined && (
          <Typography variant="meta" as="span">
            {hint}
          </Typography>
        )}
      </div>
      {hint !== undefined && (
        <ConditionList
          items={items}
          joiner={subject === 'all' ? 'and' : 'or'}
          readOnly={readOnly}
          allowScore={allowScore}
          path={path}
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
  path: string | undefined;
  onChange: (value: RawWorkflowCondition) => void;
}

function FieldComparison({
  field,
  operator,
  compared,
  readOnly,
  path,
  onChange,
}: FieldComparisonProps): ReactElement {
  const takesValue = operator !== 'isSet' && operator !== 'isNotSet';
  const isList = operator === 'in' || operator === 'notIn';

  return (
    <>
      <Input
        font="mono"
        size="sm"
        list={FIELD_NAMES_LIST_ID}
        placeholder="field"
        aria-label={nameControl('Field', path)}
        disabled={readOnly}
        value={field}
        onChange={(event) => onChange(writeFieldCondition(event.target.value, operator, compared))}
      />
      <Select
        aria-label={nameControl('Operator', path)}
        items={FIELD_OPERATOR_ITEMS}
        value={operator}
        disabled={readOnly}
        className="w-auto"
        onValueChange={(next) => onChange(writeFieldCondition(field, next, compared))}
      />
      {takesValue && (
        <ComparedValue
          compared={compared}
          isList={isList}
          readOnly={readOnly}
          path={path}
          onCommit={(next) => onChange(writeFieldCondition(field, operator, next))}
        />
      )}
    </>
  );
}

interface ComparedValueProps {
  compared: unknown;
  isList: boolean;
  readOnly: boolean;
  path: string | undefined;
  onCommit: (value: unknown) => void;
}

/** The compared value as typed text, converted only on blur so `1.` or `0` mid-typing is never rewritten. */
function ComparedValue({
  compared,
  isList,
  readOnly,
  path,
  onCommit,
}: ComparedValueProps): ReactElement {
  const [draft, setDraft] = useState(formatCompared(compared));
  const [seen, setSeen] = useState(compared);
  // A value changed from outside (undo, the JSON tab) replaces what was typed.
  if (compared !== seen) {
    setSeen(compared);
    setDraft(formatCompared(compared));
  }

  return (
    <Input
      font="mono"
      size="sm"
      placeholder={isList ? 'A, B' : 'value'}
      aria-label={nameControl('Value', path)}
      disabled={readOnly}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        // Untouched text is left alone, so a stored string such as "10" never turns into a number.
        if (draft === formatCompared(compared)) return;
        onCommit(
          isList ? draft.split(',').map((part) => parseScalar(part.trim())) : parseScalar(draft),
        );
      }}
    />
  );
}

interface ScoreComparisonProps {
  condition: StoredCondition;
  onChange: (value: RawWorkflowCondition) => void;
  readOnly: boolean;
  path: string | undefined;
}

function writeScoreCondition(
  score: unknown,
  operator: WorkflowScoreComparator,
  threshold: number | undefined,
): RawWorkflowCondition {
  return { score, [operator]: threshold } as RawWorkflowCondition;
}

function ScoreComparison({
  condition,
  onChange,
  readOnly,
  path,
}: ScoreComparisonProps): ReactElement {
  const operator = WORKFLOW_SCORE_COMPARATORS.find((key) => key in condition) ?? 'gte';
  const threshold = typeof condition[operator] === 'number' ? condition[operator] : undefined;

  return (
    <>
      <Input
        font="mono"
        size="sm"
        placeholder="score"
        aria-label={nameControl('Score', path)}
        disabled={readOnly}
        value={String(condition.score ?? '')}
        onChange={(event) => onChange(writeScoreCondition(event.target.value, operator, threshold))}
      />
      <Select
        aria-label={nameControl('Comparison', path)}
        items={SCORE_OPERATOR_ITEMS}
        value={operator}
        disabled={readOnly}
        className="w-auto"
        onValueChange={(next) => onChange(writeScoreCondition(condition.score, next, threshold))}
      />
      <Input
        type="number"
        size="sm"
        aria-label={nameControl('Threshold', path)}
        disabled={readOnly}
        value={threshold ?? ''}
        onChange={(event) =>
          onChange(
            writeScoreCondition(condition.score, operator, parseNumberInput(event.target.value)),
          )
        }
      />
    </>
  );
}

interface ConditionListProps {
  items: RawWorkflowCondition[];
  /** The word between rows: "and" for All of, "or" for Any of and None of. */
  joiner: string;
  onChange: (items: RawWorkflowCondition[]) => void;
  readOnly: boolean;
  allowScore: boolean;
  path: string | undefined;
}

function ConditionList({
  items,
  joiner,
  onChange,
  readOnly,
  allowScore,
  path,
}: ConditionListProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-tsh-yellow-500 pl-2">
      {items.map((item, index) => {
        const rowPath = path === undefined ? String(index + 1) : `${path}.${index + 1}`;

        return (
          <div
            // Rows have no identity of their own; removing one re-keys the rest.
            key={index}
            className="flex flex-col gap-1.5"
          >
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
                  allowScore={allowScore}
                  path={rowPath}
                  onChange={(next) =>
                    onChange(items.map((current, at) => (at === index ? next : current)))
                  }
                />
              </div>
              {!readOnly && items.length > 1 && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="h-6 px-1"
                  aria-label={`Remove condition ${rowPath}`}
                  onClick={() => onChange(items.filter((_, at) => at !== index))}
                >
                  <Close aria-hidden className="size-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <Button
          size="sm"
          className="self-start"
          onClick={() => onChange([...items, { ...DEFAULT_CONDITION }])}
        >
          + Add condition
        </Button>
      )}
    </div>
  );
}
