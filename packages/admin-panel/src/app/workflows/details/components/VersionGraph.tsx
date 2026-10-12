import type { ReactElement } from 'react';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import type { WorkflowVersionStatus } from '@/api/workflows/workflow-versions';
import { StepInspector } from './StepInspector/StepInspector';
import { WorkflowGraph } from './WorkflowGraph/WorkflowGraph';

export interface VersionGraphProps {
  workflowId: string;
  definition: WorkflowDefinition;
  requestedStep: string | null;
  versionStatus: WorkflowVersionStatus | null;
  onSelectStep: (step: string) => void;
}

/** A version's graph beside its step inspector; the caller provides the `ReactFlowProvider`. */
export function VersionGraph({
  workflowId,
  definition,
  requestedStep,
  versionStatus,
  onSelectStep,
}: VersionGraphProps): ReactElement | null {
  const selectedStep =
    definition.steps.find((step) => step.name === requestedStep) ??
    definition.steps.find((step) => step.name === definition.initialStep);

  if (selectedStep === undefined) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
      <div className="flex min-h-110 min-w-0 shrink-0 border-b border-border-rule bg-bg-subtle xl:min-h-0 xl:shrink xl:grow xl:basis-160 xl:border-r xl:border-b-0 [&_.react-flow]:bg-transparent">
        <WorkflowGraph
          definition={definition}
          selectedStep={selectedStep.name}
          onSelectStep={onSelectStep}
        />
      </div>
      <StepInspector workflowId={workflowId} step={selectedStep} versionStatus={versionStatus} />
    </div>
  );
}
