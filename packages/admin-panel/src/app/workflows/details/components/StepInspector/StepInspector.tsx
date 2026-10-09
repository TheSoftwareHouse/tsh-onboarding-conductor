import type { ReactElement } from 'react';
import type { WorkflowStepDefinition } from '@/api/workflows/workflow-definitions';
import {
  WORKFLOW_VERSION_STATUS,
  type WorkflowVersionStatus,
} from '@/api/workflows/workflow-versions';
import { Chip } from '@/components/ui/Chip/Chip';
import { Lock } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { describeStepKind } from '../../constants/step-kind-labels';
import { StepConnectors } from './StepConnectors';
import { StepRequirements } from './StepRequirements';
import { StepTransitions } from './StepTransitions';

export interface StepInspectorProps {
  step: WorkflowStepDefinition;
  versionStatus: WorkflowVersionStatus | null;
}

/** The read-only right rail for the selected step: its kind and status, fields, connectors and transitions. */
export function StepInspector({ step, versionStatus }: StepInspectorProps): ReactElement {
  const revisions =
    versionStatus === WORKFLOW_VERSION_STATUS.published || versionStatus === null
      ? 'published'
      : 'stored';

  return (
    <aside
      aria-label="Selected step"
      className="flex min-h-0 max-w-none min-w-80 shrink-0 flex-col border-t border-border-rule **:leading-natural xl:max-w-140 xl:shrink xl:grow xl:basis-95 xl:overflow-y-auto xl:border-t-0 xl:border-l"
    >
      <header className="flex flex-col gap-2 border-b border-border-hair px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <Typography variant="caps-tiny" as="span" className="text-fg-4">
            Selected step
          </Typography>
          {step.source !== null && (
            <Chip tone="neutral-strong" className="px-2.5 leading-natural font-medium">
              {describeStepKind(step.source.type)}
            </Chip>
          )}
        </div>
        <h2 className="font-mono text-body-lg-alt/normal font-normal wrap-anywhere text-tsh-black">
          {step.name}
        </h2>
        <Typography variant="body-sm" as="span" className="leading-natural">
          Status while here:{' '}
          <span className="font-mono text-mono text-tsh-black">{step.status}</span>
        </Typography>
        <Typography
          variant="meta"
          as="span"
          className="flex items-center gap-1.5 leading-natural font-normal tracking-normal"
        >
          <Lock aria-hidden="true" className="size-4" />
          Read-only — {revisions} revisions never change shape
        </Typography>
      </header>
      <StepRequirements step={step} />
      {step.connectors.length > 0 && <StepConnectors connectors={step.connectors} />}
      <StepTransitions step={step} />
    </aside>
  );
}
