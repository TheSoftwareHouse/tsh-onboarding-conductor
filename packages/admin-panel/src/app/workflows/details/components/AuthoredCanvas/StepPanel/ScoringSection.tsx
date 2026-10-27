import { useId, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input/Input';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { readConfigScoring, type AuthoredStep } from '../../../utils/authored-document';
import { DEFAULT_CONDITION } from '../../../utils/config-schema';
import { pluralize } from '../../../utils/pluralize';
import { ConditionEditor } from '../SchemaForm/ConditionEditor';
import { InspectorBand } from '../InspectorBand';

type Rule = NonNullable<AuthoredStep['scoring']>[number];

const NEW_RULE_POINTS = 1;

/** The points a typed box holds, or `null` when it is not a non-zero whole number. */
function parsePoints(text: string): number | null {
  const points = Number(text);
  return text.trim() !== '' && Number.isInteger(points) && points !== 0 ? points : null;
}

export interface ScoringSectionProps {
  step: AuthoredStep;
  /** The score names the workflow declares. */
  declared: readonly string[];
  readOnly: boolean;
  /** Writes the step-level `scoring` rules. */
  onRules: (rules: Rule[]) => void;
  /** Writes a `custom` step's `config.scoring` rules. */
  onConfigRules: (rules: Rule[]) => void;
}

/** A rule with the list it is stored in; a `custom` step has two, shown config first. */
type Entry = { rule: Rule; inConfig: boolean };

/** A step's own scoring rules: which score each moves, by how much, and when. */
export function ScoringSection({
  step,
  declared,
  readOnly,
  onRules,
  onConfigRules,
}: ScoringSectionProps): ReactElement {
  const configRules = readConfigScoring(step);
  const stepRules = step.scoring ?? [];
  const entries: Entry[] = [
    ...configRules.map((rule) => ({ rule, inConfig: true })),
    ...stepRules.map((rule) => ({ rule, inConfig: false })),
  ];
  // A custom step keeps its rules in its config; new ones go there too.
  const addsToConfig = step.type === STEP_TYPE.custom;

  // Rules naming nothing declared still show, so they can be fixed or removed here.
  if (declared.length === 0 && entries.length === 0) {
    return (
      <InspectorBand title="Scoring">
        <Typography variant="meta">
          Declare a score in Workflow settings to score this step.
        </Typography>
      </InspectorBand>
    );
  }

  /** Writes the list `entry` belongs to with its `index` among them replaced by `next`, or removed when `next` is null. */
  function writeRule(inConfig: boolean, index: number, next: Rule | null): void {
    const list = inConfig ? configRules : stepRules;
    const rules =
      next === null
        ? list.filter((_, at) => at !== index)
        : list.map((rule, at) => (at === index ? next : rule));
    (inConfig ? onConfigRules : onRules)(rules);
  }

  return (
    <InspectorBand
      title="Scoring"
      meta={pluralize(entries.length, 'rule')}
      trailing={
        !readOnly && declared[0] !== undefined ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const rule = { score: declared[0]!, add: NEW_RULE_POINTS };
              if (addsToConfig) onConfigRules([...configRules, rule]);
              else onRules([...stepRules, rule]);
            }}
          >
            + Add rule
          </Button>
        ) : undefined
      }
    >
      <Typography variant="meta" className="leading-natural">
        Adds points to a score when this step is submitted.
      </Typography>
      {entries.map(({ rule, inConfig }, number) => {
        const index = inConfig ? number : number - configRules.length;
        return (
          <RuleRow
            // Rules have no identity of their own; removing one re-keys the rest.
            key={number}
            number={number + 1}
            rule={rule}
            declared={declared}
            readOnly={readOnly}
            onChange={(next) => writeRule(inConfig, index, next)}
            onRemove={() => writeRule(inConfig, index, null)}
          />
        );
      })}
    </InspectorBand>
  );
}

interface RuleRowProps {
  number: number;
  rule: Rule;
  declared: readonly string[];
  readOnly: boolean;
  onChange: (rule: Rule) => void;
  onRemove: () => void;
}

function RuleRow({
  number,
  rule,
  declared,
  readOnly,
  onChange,
  onRemove,
}: RuleRowProps): ReactElement {
  // Holds the text only while it is not yet a valid number, so a valid edit shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  // Rows are keyed by index, so a draft belongs to the rule it was typed on: drop it when the rule changes.
  const [draftRule, setDraftRule] = useState(`${rule.score}:${rule.add}`);
  if (draftRule !== `${rule.score}:${rule.add}`) {
    setDraftRule(`${rule.score}:${rule.add}`);
    setDraft(null);
  }
  const errorId = useId();
  const isDeclared = declared.includes(rule.score);
  const scores = isDeclared ? declared : [...declared, rule.score];

  return (
    <div
      role="group"
      aria-label={`Rule ${number}`}
      className="flex flex-col gap-2 border border-border-rule p-3"
    >
      <div className="flex items-center gap-2">
        <Select
          aria-label={`Score of rule ${number}`}
          items={scores.map((score) => ({
            value: score,
            label: declared.includes(score) ? score : `${score} (not declared)`,
          }))}
          value={rule.score}
          disabled={readOnly}
          className="h-9 min-w-0 flex-1"
          onValueChange={(score) => onChange({ ...rule, score })}
        />
        <Input
          type="number"
          size="sm"
          step={1}
          aria-label={`Points of rule ${number}`}
          aria-invalid={draft !== null}
          aria-describedby={draft !== null ? errorId : undefined}
          disabled={readOnly}
          className="w-24"
          value={draft ?? String(rule.add)}
          onChange={(event) => {
            const points = parsePoints(event.target.value);
            setDraft(points === null ? event.target.value : null);
            if (points !== null) onChange({ ...rule, add: points });
          }}
        />
        {!readOnly && (
          <Button
            variant="quiet"
            size="sm"
            className="h-7 px-1"
            aria-label={`Remove rule ${number}`}
            onClick={onRemove}
          >
            <Close aria-hidden className="size-5" />
          </Button>
        )}
      </div>
      {draft !== null && (
        <Typography id={errorId} variant="meta" className="text-tsh-red" role="alert">
          Points must be a whole number, not 0.
        </Typography>
      )}
      {rule.when === undefined ? (
        !readOnly && (
          <Button
            size="sm"
            className="self-start"
            aria-label={`Add condition to rule ${number}`}
            onClick={() => onChange({ ...rule, when: DEFAULT_CONDITION })}
          >
            + Add condition
          </Button>
        )
      ) : (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <ConditionEditor
              value={rule.when}
              readOnly={readOnly}
              allowScore={false}
              onChange={(when) => onChange({ ...rule, when })}
            />
          </div>
          {!readOnly && (
            <Button
              variant="quiet"
              size="sm"
              className="h-6 px-1"
              aria-label={`Remove condition of rule ${number}`}
              onClick={() => onChange({ score: rule.score, add: rule.add })}
            >
              <Close aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
