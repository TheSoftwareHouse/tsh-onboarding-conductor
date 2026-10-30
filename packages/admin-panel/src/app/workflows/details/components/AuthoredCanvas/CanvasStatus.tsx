import type { ReactElement } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import type { ProjectedStep } from '../../utils/authored-projection';
import { pluralize } from '../../utils/pluralize';

/** The last Validate failure: why, where in the document, and the step it named. */
export interface CanvasFailure {
  reason: string;
  path: string | null;
  step: string | null;
}

export interface CanvasStatusProps {
  steps: readonly ProjectedStep[];
  edgeCount: number;
  /** Problems of the workflow itself, fixed in Workflow settings. */
  workflowIssues: readonly string[];
  failure: CanvasFailure | null;
  onFocusStep: (name: string) => void;
  onOpenSettings: () => void;
}

/** Counts, the steps that cannot run as written, and the last Validate failure. */
export function CanvasStatus({
  steps,
  edgeCount,
  workflowIssues,
  failure,
  onFocusStep,
  onOpenSettings,
}: CanvasStatusProps): ReactElement {
  const withIssues = steps.filter((step) => step.issues.length > 0);
  const owners = [
    workflowIssues.length > 0 ? 'workflow' : null,
    withIssues.length > 0 ? pluralize(withIssues.length, 'step') : null,
  ].filter((owner) => owner !== null);
  const failedStep = steps.find((step) => step.step.name === failure?.step)?.step.name;

  return (
    <div className="pointer-events-auto flex max-w-80 flex-col gap-1 border border-border-rule bg-bg-page px-3 py-2">
      <Typography variant="meta">
        {pluralize(steps.length, 'step')} · {pluralize(edgeCount, 'edge')}
      </Typography>
      {owners.length > 0 ? (
        <>
          <Typography variant="meta" className="text-tsh-red">
            ⚠ {owners.join(' and ')} with problems
          </Typography>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {workflowIssues.length > 0 && (
              <ProblemEntry
                title="Workflow settings"
                issues={workflowIssues}
                onClick={onOpenSettings}
              />
            )}
            {withIssues.map((step) => (
              <ProblemEntry
                key={step.step.name}
                title={step.step.name}
                issues={step.issues}
                onClick={() => onFocusStep(step.step.name)}
              />
            ))}
          </ul>
        </>
      ) : (
        <Typography variant="meta">No problems found on the canvas</Typography>
      )}
      {failure !== null && (
        <Typography variant="meta" className="text-tsh-red">
          Last Validate: {failure.reason}
          {failedStep !== undefined ? (
            <>
              {' at '}
              {/* Inline in a sentence, which a ui Button is not. */}
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={() => onFocusStep(failedStep)}
              >
                <Typography variant="mono" as="span" className="text-tsh-red">
                  {failedStep}
                </Typography>
              </button>
            </>
          ) : (
            failure.path !== null && ` at ${failure.path}`
          )}
        </Typography>
      )}
    </div>
  );
}

interface ProblemEntryProps {
  title: string;
  issues: readonly string[];
  onClick: () => void;
}

/** One owner of problems, the workflow or a step, listing each issue under its name. */
function ProblemEntry({ title, issues, onClick }: ProblemEntryProps): ReactElement {
  return (
    <li>
      {/* A list row holding a heading and lines has no ui equivalent. */}
      <button
        type="button"
        className="flex w-full cursor-pointer flex-col text-left hover:underline"
        onClick={onClick}
      >
        <Typography variant="mono" as="span" className="leading-4 wrap-break-word text-tsh-red">
          {title}:
        </Typography>
        {issues.map((issue) => (
          <Typography
            key={issue}
            variant="meta"
            as="span"
            className="pl-4 -indent-2 leading-4 wrap-break-word text-tsh-red"
          >
            {issue}
          </Typography>
        ))}
      </button>
    </li>
  );
}
