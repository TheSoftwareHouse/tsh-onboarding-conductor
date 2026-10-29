import type { ReactElement } from 'react';
import type { RawWorkflowTransition } from '@tsh/ddl-schema/workflow-contract';
import { Button } from '@/components/ui/Button/Button';
import { Typography } from '@/components/ui/Typography/Typography';
import type { CanvasPort } from '../../../utils/authored-projection';
import { checkStepConfig, toEntryPath } from '../../../utils/check-config';
import { buildDefault, resolveSchema, toRef } from '../../../utils/config-schema';
import { AddButton, DeleteButton } from '../EntryActions';
import { EntryCard } from '../EntryCard';
import { EntryTitle } from '../EntryTitle';
import { ConfigFormContext } from '../SchemaForm/config-form-context';
import { ObjectForm } from '../SchemaForm/ObjectForm';
import { TargetSelect } from './TargetSelect';

const TRANSITION_SCHEMA = { $ref: toRef('transition') };
const REJECTED_STATUS = 'rejected';

export interface CustomTransitionsProps {
  stepType: string;
  config: Record<string, unknown>;
  transitions: RawWorkflowTransition[];
  /** The step's projected ports, one per transition, for their labels. */
  ports: readonly CanvasPort[];
  stepNames: string[];
  readOnly: boolean;
  onChange: (transitions: RawWorkflowTransition[]) => void;
}

/** A `custom` step's transitions, tried in order: status, condition and target of each, added and removed here. */
export function CustomTransitions({
  stepType,
  config,
  transitions,
  ports,
  stepNames,
  readOnly,
  onChange,
}: CustomTransitionsProps): ReactElement {
  const schema = resolveSchema(TRANSITION_SCHEMA);
  const update = (index: number, transition: RawWorkflowTransition): void =>
    onChange(transitions.map((current, at) => (at === index ? transition : current)));
  const move = (index: number, by: -1 | 1): void => {
    const next = [...transitions];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    onChange(next);
  };

  return (
    <ConfigFormContext.Provider
      value={{ stepType, renameField: null, failures: checkStepConfig(stepType, config) }}
    >
      <div className="flex flex-col gap-2">
        {transitions.map((transition, index) => {
          const portName = ports[index]?.label ?? `transition ${index + 1}`;
          const { target, ...rest } = transition;

          return (
            // Transitions have no identity of their own; removing one re-keys the rest.
            <EntryCard
              key={index}
              header={
                <>
                  <EntryTitle>{portName}</EntryTitle>
                  {!readOnly && (
                    <span className="flex gap-1">
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={index === 0}
                        aria-label={`Move ${portName} up`}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={index === transitions.length - 1}
                        aria-label={`Move ${portName} down`}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </Button>
                      <DeleteButton
                        label={`Remove ${portName}`}
                        onClick={() => onChange(transitions.filter((_, at) => at !== index))}
                      />
                    </span>
                  )}
                </>
              }
            >
              <ObjectForm
                schema={schema}
                value={rest}
                path={toEntryPath('transitions', index)}
                readOnly={readOnly}
                // Only a rejection carries a reason; the target is the select below.
                skip={transition.status === REJECTED_STATUS ? ['target'] : ['target', 'reason']}
                onChange={(next) =>
                  update(index, {
                    ...(next as RawWorkflowTransition),
                    ...(target === undefined ? {} : { target }),
                  })
                }
              />
              <div className="flex items-center justify-between gap-2">
                <Typography variant="meta" as="span">
                  Go to
                </Typography>
                <TargetSelect
                  aria-label={`Target of ${portName}`}
                  value={target ?? null}
                  stepNames={stepNames}
                  readOnly={readOnly}
                  emptyLabel="Stay on this step"
                  onChange={(next) =>
                    update(index, next === null ? rest : { ...rest, target: next })
                  }
                />
              </div>
            </EntryCard>
          );
        })}
        {!readOnly && (
          <AddButton
            onClick={() =>
              onChange([...transitions, buildDefault(TRANSITION_SCHEMA) as RawWorkflowTransition])
            }
          >
            transition
          </AddButton>
        )}
      </div>
    </ConfigFormContext.Provider>
  );
}
