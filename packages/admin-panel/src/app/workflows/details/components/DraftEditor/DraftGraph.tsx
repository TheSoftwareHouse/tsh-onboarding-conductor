import { useEffect, useEffectEvent, type ReactElement } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { readDraftError } from '@/api/workflows/workflow-drafts';
import { Button } from '@/components/ui/Button/Button';
import { ErrorState } from '@/components/ui/ErrorState/ErrorState';
import { Loader } from '@/components/ui/Loader/Loader';
import { CANVAS_ERROR_TITLE } from '../../constants/canvas-error';
import { describeCanvasError } from '../../utils/describe-canvas-error';
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
    return <Loader label="Compiling…" />;
  }

  // Auth, network or 5xx: the request failed, not the document.
  if (outcome.kind === 'invalid' && readDraftError(outcome.error) === null) {
    return (
      <ErrorState
        title="Unable to compile this draft"
        body={outcome.error.message}
        actions={
          <Button variant="primary" size="lg" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }

  if (outcome.kind !== 'valid') {
    return (
      <ErrorState
        title={CANVAS_ERROR_TITLE}
        body={describeCanvasError('This draft does not compile.')}
        actions={
          <Button variant="primary" size="lg" onClick={onShowJson}>
            Open JSON tab
          </Button>
        }
      />
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
