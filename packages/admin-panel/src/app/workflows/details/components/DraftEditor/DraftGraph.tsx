import { useEffect, useEffectEvent, type ReactElement } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { readDraftError } from '@/api/workflows/workflow-drafts';
import { Button } from '@/components/ui/Button/Button';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { VersionGraph } from '../VersionGraph';
import type { ValidationOutcome } from './ValidationResult';

export interface DraftGraphProps {
  workflowId: string;
  outcome: ValidationOutcome | null;
  requestedStep: string | null;
  onCompile: () => void;
  onSelectStep: (step: string) => void;
  onShowJson: () => void;
  /** Drops the held failure, so the tab compiles again. */
  onRetry: () => void;
}

/** The draft's graph, drawn from the editor's compile result; it asks for one when none is held. */
export function DraftGraph({
  workflowId,
  outcome,
  requestedStep,
  onCompile,
  onSelectStep,
  onShowJson,
  onRetry,
}: DraftGraphProps): ReactElement {
  const compile = useEffectEvent(onCompile);

  useEffect(() => {
    if (outcome === null) {
      compile();
    }
  }, [outcome]);

  if (outcome === null) {
    return <StatusRegion className="px-8 py-6">Compiling…</StatusRegion>;
  }

  // Auth, network or 5xx: the request failed, not the document.
  if (outcome.kind === 'invalid' && readDraftError(outcome.error) === null) {
    return (
      <div className="flex flex-col items-start gap-4 p-8">
        <StatusRegion>{`Unable to compile this draft: ${outcome.error.message}`}</StatusRegion>
        <Button variant="secondary" size="md" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (outcome.kind !== 'valid') {
    return (
      <div className="flex flex-col items-start gap-4 p-8">
        <StatusRegion>This draft does not compile. Fix it on the JSON tab.</StatusRegion>
        <Button variant="secondary" size="md" onClick={onShowJson}>
          Show JSON
        </Button>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <VersionGraph
        workflowId={workflowId}
        definition={outcome.workflow}
        requestedStep={requestedStep}
        versionStatus="draft"
        onSelectStep={onSelectStep}
      />
    </ReactFlowProvider>
  );
}
