import type { ReactElement } from 'react';
import type { WorkflowStepDefinition } from '@/api/workflows/workflow-definitions';
import { Typography } from '@/components/ui/Typography/Typography';
import { describeField } from '../../utils/describe-field';

export interface StepRequirementsProps {
  step: WorkflowStepDefinition;
}

/** The fields the step collects, each with its constraints line. */
export function StepRequirements({ step }: StepRequirementsProps): ReactElement {
  return (
    <section className="flex flex-col gap-3.5 border-b border-border-hair px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <Typography variant="caps-tiny" as="h3" className="text-fg-3">
          Requirements
        </Typography>
        <Typography
          variant="meta"
          as="span"
          className="leading-natural font-normal tracking-normal"
        >
          {step.fields.length === 1 ? '1 field' : `${step.fields.length} fields`}
        </Typography>
      </div>
      {step.fields.length > 0 && (
        <ul className="flex flex-col">
          {step.fields.map((field) => (
            <li
              key={field.name}
              className="flex flex-col gap-0.75 border-b border-tsh-black/6 py-2.5"
            >
              <span className="font-mono text-mono text-tsh-black">{field.name}</span>
              <Typography
                variant="meta"
                as="span"
                className="leading-natural font-normal tracking-normal text-pretty"
              >
                {describeField(field)}
              </Typography>
            </li>
          ))}
        </ul>
      )}
      {step.terminal && (
        <Typography
          variant="meta"
          className="leading-natural font-normal tracking-normal text-pretty"
        >
          A terminal step collects nothing and declares no transitions — the onboarding settles
          here.
        </Typography>
      )}
      {!step.terminal && step.fields.length === 0 && (
        <Typography
          variant="meta"
          className="leading-natural font-normal tracking-normal text-pretty"
        >
          This step collects no fields.
        </Typography>
      )}
    </section>
  );
}
