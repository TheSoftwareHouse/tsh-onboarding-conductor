import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Typography } from '@/components/ui/Typography/Typography';
import { UNWIRED, type AuthoredArm } from '../../../utils/authored-document';
import { buildDefault, toRef, TRANSITION_CONDITION_REF } from '../../../utils/config-schema';
import { ConditionEditor } from '../SchemaForm/ConditionEditor';
import { TargetSelect } from './TargetSelect';

export interface PortArmsProps {
  /** The port's name as the panel shows it. */
  label: ReactNode;
  /** The same name as plain text, for the controls' accessible names. */
  portName: string;
  arms: AuthoredArm[];
  stepNames: string[];
  readOnly: boolean;
  /** A plain port: `null` unwires it. */
  onWire: (target: string | null) => void;
  /** A branched port: the arms to write, fallback last. */
  onArms: (arms: AuthoredArm[]) => void;
}

/** Arms are tried in order and one arm may have no condition, last; the fallback stays pinned there. */
export function PortArms({
  label,
  portName,
  arms,
  stepNames,
  readOnly,
  onWire,
  onArms,
}: PortArmsProps): ReactElement {
  const guarded = arms.filter((arm) => arm.when !== undefined);
  const fallback = arms.find((arm) => arm.when === undefined);
  const emit = (nextGuarded: AuthoredArm[], nextFallback: AuthoredArm | undefined): void =>
    onArms([...nextGuarded, ...(nextFallback ? [nextFallback] : [])]);
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
  const addCondition = (): void =>
    emit(
      [
        ...guarded,
        {
          when: buildDefault({ $ref: toRef(TRANSITION_CONDITION_REF) }) as AuthoredArm['when'],
          target: UNWIRED,
        },
      ],
      fallback,
    );

  const addButton = !readOnly && (
    <Button variant="quiet" size="sm" className="self-start px-0" onClick={addCondition}>
      + Condition
    </Button>
  );

  // A plain edge is one target, plus a way to start branching it.
  if (guarded.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          {label}
          <TargetSelect
            aria-label={`Target of ${portName}`}
            value={fallback?.target ?? null}
            stepNames={stepNames}
            readOnly={readOnly}
            emptyLabel="Not wired"
            onChange={onWire}
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
                  variant="danger"
                  size="sm"
                  aria-label={`Remove arm ${index + 1} of ${portName}`}
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
              aria-label={`Target of ${portName} condition ${index + 1}`}
              value={arm.target}
              stepNames={stepNames}
              readOnly={readOnly}
              emptyLabel="Choose a step"
              onChange={(target) => updateArm(index, { ...arm, target: target ?? UNWIRED })}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Typography variant="meta" as="span">
          Otherwise
        </Typography>
        <TargetSelect
          aria-label={`Fallback target of ${portName}`}
          value={fallback?.target ?? null}
          stepNames={stepNames}
          readOnly={readOnly}
          emptyLabel="No fallback"
          onChange={(target) => emit(guarded, target === null ? undefined : { target })}
        />
      </div>
      {addButton}
    </div>
  );
}
