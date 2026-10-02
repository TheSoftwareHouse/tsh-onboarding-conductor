import type { ReactElement } from 'react';
import type { WorkflowStepDefinition } from '@/api/workflows/workflow-definitions';
import { Typography } from '@/components/ui/Typography/Typography';
import { describeTransition } from '../../utils/describe-transition';
import { isSelfTransition } from '../../utils/is-self-transition';

export interface StepTransitionsProps {
  step: WorkflowStepDefinition;
}

/** Where the step can go, each with its rule; transitions onto the step itself are listed apart. */
export function StepTransitions({ step }: StepTransitionsProps): ReactElement {
  const outgoing = step.transitions.filter(
    (transition) => !isSelfTransition(step, transition.target),
  );
  const onto = step.transitions.filter((transition) => isSelfTransition(step, transition.target));

  return (
    <section className="flex flex-col gap-3.5 px-6 py-5">
      <Typography variant="caps-tiny" as="h3" className="text-fg-3">
        Transitions out
      </Typography>
      {outgoing.length > 0 && (
        <ul className="flex flex-col">
          {outgoing.map((transition, index) => (
            <li
              key={`${transition.target}-${index}`}
              className="flex min-w-0 flex-col gap-1 border-b border-tsh-black/6 py-3"
            >
              <span className="text-body-sm wrap-anywhere text-tsh-black">
                → {transition.target}
              </span>
              <span className="font-mono text-body-2xs text-pretty text-fg-3">
                {describeTransition(step, transition)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {outgoing.length === 0 && onto.length === 0 && (
        <Typography variant="meta">No transitions out.</Typography>
      )}
      {onto.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Typography
            variant="meta"
            as="span"
            className="text-body-2xs font-medium tracking-caps text-tsh-gray-400 uppercase"
          >
            Onto itself
          </Typography>
          {onto.map((transition, index) => (
            <span
              key={`${transition.status}-${index}`}
              className="font-mono text-caps-tiny font-normal tracking-normal text-tsh-black"
            >
              ↻ {transition.status}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
