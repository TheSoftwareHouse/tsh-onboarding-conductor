// PoC (throwaway): one port's branches. Arms are tried in order and the engine allows one arm with
// no condition, last; so conditions are added and reordered above a fallback that stays pinned last.
import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Typography } from '@/components/ui/Typography/Typography';
import { UNWIRED, type AuthoredArm } from './authored-graph';
import { ConditionEditor } from './SchemaForm/ConditionEditor';
import { buildDefault } from './SchemaForm/schema-utils';

export interface PortArmsProps {
  label: ReactNode;
  arms: AuthoredArm[];
  stepNames: string[];
  readOnly: boolean;
  onChange: (arms: AuthoredArm[]) => void;
}

/** The fallback select's value for "no fallback": a port whose conditions all miss goes nowhere. */
const NO_FALLBACK = '\u0000none';
const SELECT = 'border border-border-strong px-1 py-0.5 text-body-sm';

function TargetSelect({
  value,
  stepNames,
  readOnly,
  empty,
  onChange,
}: {
  value: string;
  stepNames: string[];
  readOnly: boolean;
  /** The first option: what leaving the select unset means here. */
  empty: { value: string; label: string };
  onChange: (target: string) => void;
}): ReactElement {
  return (
    <select
      disabled={readOnly}
      className={SELECT}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={empty.value}>{empty.label}</option>
      {value === UNWIRED && empty.value !== UNWIRED && (
        <option value={UNWIRED}>— choose a step —</option>
      )}
      {stepNames.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

export function PortArms({
  label,
  arms,
  stepNames,
  readOnly,
  onChange,
}: PortArmsProps): ReactElement {
  const guarded = arms.filter((arm) => arm.when !== undefined);
  const fallback = arms.find((arm) => arm.when === undefined);
  const emit = (nextGuarded: AuthoredArm[], nextFallback: AuthoredArm | undefined): void =>
    onChange([...nextGuarded, ...(nextFallback ? [nextFallback] : [])]);
  const addCondition = (): void =>
    emit(
      [
        ...guarded,
        { when: buildDefault({ $ref: '#/definitions/transitionCondition' }), target: UNWIRED },
      ],
      fallback,
    );
  const updateArm = (index: number, arm: AuthoredArm): void =>
    emit(
      guarded.map((current, candidate) => (candidate === index ? arm : current)),
      fallback,
    );
  const moveArm = (index: number, by: -1 | 1): void => {
    const next = [...guarded];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    emit(next, fallback);
  };
  const setFallback = (target: string): void =>
    emit(guarded, target === NO_FALLBACK ? undefined : { ...fallback, target });

  const addButton = !readOnly && (
    <Button variant="quiet" size="sm" className="self-start px-0" onClick={addCondition}>
      + Condition
    </Button>
  );

  // A plain edge reads as before: a target, plus a way to start branching it.
  if (guarded.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          {label}
          <TargetSelect
            value={fallback?.target ?? UNWIRED}
            stepNames={stepNames}
            readOnly={readOnly}
            empty={{ value: UNWIRED, label: '— unwired —' }}
            onChange={(target) => emit([], target === UNWIRED ? undefined : { target })}
          />
        </div>
        {addButton}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {label}
      {guarded.map((arm, index) => (
        <div key={index} className="flex flex-col gap-2 border border-border-rule p-2">
          <div className="flex items-center justify-between gap-2">
            <Typography variant="meta" as="span">
              {index === 0 ? 'If' : 'Else if'}
            </Typography>
            {!readOnly && (
              <span className="flex gap-1">
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={index === 0}
                  aria-label="Move condition up"
                  onClick={() => moveArm(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={index === guarded.length - 1}
                  aria-label="Move condition down"
                  onClick={() => moveArm(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  className="text-tsh-red"
                  onClick={() =>
                    emit(
                      guarded.filter((_, candidate) => candidate !== index),
                      fallback,
                    )
                  }
                >
                  Remove
                </Button>
              </span>
            )}
          </div>
          <ConditionEditor
            value={arm.when}
            readOnly={readOnly}
            onChange={(when) => updateArm(index, { ...arm, when })}
          />
          <div className="flex items-center justify-between gap-2">
            <Typography variant="meta" as="span">
              go to
            </Typography>
            <TargetSelect
              value={arm.target}
              stepNames={stepNames}
              readOnly={readOnly}
              empty={{ value: UNWIRED, label: '— choose a step —' }}
              onChange={(target) => updateArm(index, { ...arm, target })}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Typography variant="meta" as="span">
          Otherwise
        </Typography>
        <TargetSelect
          value={fallback === undefined ? NO_FALLBACK : fallback.target}
          stepNames={stepNames}
          readOnly={readOnly}
          empty={{ value: NO_FALLBACK, label: '— no fallback —' }}
          onChange={setFallback}
        />
      </div>
      {addButton}
    </div>
  );
}
