import type { ReactElement } from 'react';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import { Typography } from '@/components/ui/Typography/Typography';
import { WorkflowZoomControls } from './WorkflowZoomControls';

export interface WorkflowStatsProps {
  /** Null while the definition loads: the counts are omitted and the zoom controls stay. */
  definition: WorkflowDefinition | null;
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <Typography variant="body-sm" as="span">
      {label} <span className="font-mono text-mono text-tsh-black">{value}</span>
    </Typography>
  );
}

/** Counts, the initial step and the webhook on the left; the graph's zoom controls on the right. */
export function WorkflowStats({ definition }: WorkflowStatsProps): ReactElement {
  const transitionCount =
    definition?.steps.reduce((sum, step) => sum + step.transitions.length, 0) ?? 0;

  return (
    <div className="flex flex-none flex-wrap items-stretch border-b border-border-rule **:leading-natural">
      <div className="flex min-w-0 grow basis-105 flex-wrap items-center gap-x-8 gap-y-3 px-8 py-3.5">
        {definition !== null && (
          <>
            <Typography variant="body-sm" as="span">
              {definition.steps.length} steps
            </Typography>
            <Typography variant="body-sm" as="span">
              {transitionCount} transitions
            </Typography>
            <Stat label="Initial" value={definition.initialStep} />
            {definition.webhook !== null && (
              <Stat
                label="Webhook"
                value={`/${definition.webhook.notify.path.replace(/^\//, '')}`}
              />
            )}
          </>
        )}
      </div>
      <div className="flex flex-none items-center border-l border-border-rule px-8 py-3.5">
        <WorkflowZoomControls />
      </div>
    </div>
  );
}
