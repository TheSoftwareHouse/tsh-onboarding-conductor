import type { ReactElement } from 'react';
import type { WorkflowStepDefinition } from '@/api/workflows/workflow-definitions';
import {
  WORKFLOW_VERSION_STATUS,
  type WorkflowVersionStatus,
} from '@/api/workflows/workflow-versions';
import { Lock } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { StepConnectors } from './StepConnectors';
import { StepRequirements } from './StepRequirements';
import { StepTransitions } from './StepTransitions';

export interface StepInspectorProps {
  workflowId: string;
  version: number;
  step: WorkflowStepDefinition;
  versionStatus: WorkflowVersionStatus | null;
}

/** The right rail for the selected step, read-only apart from a stored version's connector binding: its name, authored step and status, fields, connectors and transitions. */
export function StepInspector({
  workflowId,
  version,
  step,
  versionStatus,
}: StepInspectorProps): ReactElement {
  const isDraft = versionStatus === WORKFLOW_VERSION_STATUS.draft;
  const isRetired = versionStatus === WORKFLOW_VERSION_STATUS.retired;
  const readOnly = versionStatus !== null && versionStatus !== WORKFLOW_VERSION_STATUS.published;

  return (
    <aside
      aria-label="Selected step"
      className="flex min-h-0 max-w-none min-w-80 shrink-0 flex-col border-t border-border-rule **:leading-natural xl:max-w-140 xl:shrink xl:grow xl:basis-95 xl:overflow-y-auto xl:border-t-0 xl:border-l"
    >
      <header className="flex flex-col gap-2 border-b border-border-hair px-6 py-5">
        <Typography variant="caps-tiny" as="span" className="text-fg-4">
          Selected step
        </Typography>
        <h2 className="font-mono text-body-lg-alt/normal font-normal wrap-anywhere text-tsh-black">
          {step.name}
        </h2>
        {step.source !== null && (
          <Typography variant="meta" className="text-body-2xs wrap-anywhere">
            From {step.source.step} · {step.source.type}
          </Typography>
        )}
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
          {isDraft && 'Read-only here — edit the draft, connectors included, on the JSON tab'}
          {isRetired && 'Read-only — a retired version never runs'}
          {!readOnly &&
            'Shape is read-only — published revisions never change shape; the connector binding is editable'}
        </Typography>
      </header>
      <StepRequirements step={step} />
      {step.connectors.length > 0 && (
        <StepConnectors
          workflowId={workflowId}
          version={version}
          stepName={step.name}
          connectors={step.connectors}
          readOnly={readOnly}
        />
      )}
      <StepTransitions step={step} />
    </aside>
  );
}
