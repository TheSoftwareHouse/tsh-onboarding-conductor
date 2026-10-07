import type { ReactElement } from 'react';
import type { WorkflowDraftError } from '@/api/workflows/workflow-drafts';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { DRAFT_ERROR_MESSAGES } from '../../../constants/draft-messages';

export type ValidationOutcome =
  | { kind: 'valid'; stepCount: number }
  | { kind: 'syntax'; message: string }
  | { kind: 'invalid'; error: WorkflowDraftError };

export interface ValidationResultProps {
  outcome: ValidationOutcome | null;
}

function stepsLabel(count: number): string {
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

/** What Validate found, in a live region under the editor; empty until Validate runs, and again after the next edit. */
export function ValidationResult({ outcome }: ValidationResultProps): ReactElement {
  return (
    <StatusRegion className="flex flex-none flex-col gap-1 px-8 py-4 empty:py-0">
      {outcome?.kind === 'valid' && (
        <span className="text-fg-1">{`Valid · ${stepsLabel(outcome.stepCount)}`}</span>
      )}
      {outcome?.kind === 'syntax' && (
        <span className="text-tsh-red">{`Invalid JSON: ${outcome.message}`}</span>
      )}
      {outcome?.kind === 'invalid' && <InvalidDetails error={outcome.error} />}
    </StatusRegion>
  );
}

function InvalidDetails({ error }: { error: WorkflowDraftError }): ReactElement {
  const detail = [error.reason, error.path].filter((part) => part !== undefined).join(' · ');

  return (
    <>
      <span className="font-mono text-mono text-tsh-red">{error.code ?? 'Request failed'}</span>
      {detail !== '' && <span className="font-mono text-mono text-fg-1">{detail}</span>}
      <span>{error.code === null ? error.message : DRAFT_ERROR_MESSAGES[error.code]}</span>
    </>
  );
}
