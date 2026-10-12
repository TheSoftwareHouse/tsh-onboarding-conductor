import type { ReactElement } from 'react';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import { readDraftError } from '@/api/workflows/workflow-drafts';
import type { ApiError } from '@/services/api/api-error';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { DRAFT_ERROR_MESSAGES } from '../../../constants/draft-messages';

export type ValidationOutcome =
  | { kind: 'valid'; stepCount: number; workflow: WorkflowDefinition }
  | { kind: 'syntax'; message: string }
  | { kind: 'invalid'; error: ApiError };

export interface ValidationResultProps {
  outcome: ValidationOutcome | null;
}

function stepsLabel(count: number): string {
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

/** What Validate found, in a live region above the tabs; empty until a compile runs, and again after the next edit. */
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

function InvalidDetails({ error }: { error: ApiError }): ReactElement {
  const draftError = readDraftError(error);
  const detail = [draftError?.reason, draftError?.path]
    .filter((part) => part !== undefined)
    .join(' · ');

  return (
    <>
      <span className="font-mono text-mono text-tsh-red">
        {draftError?.code ?? 'Request failed'}
      </span>
      {detail !== '' && <span className="font-mono text-mono text-fg-1">{detail}</span>}
      <span>{draftError === null ? error.message : DRAFT_ERROR_MESSAGES[draftError.code]}</span>
    </>
  );
}
