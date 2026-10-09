import { useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import { readDraftError, type WorkflowDraftErrorCode } from '@/api/workflows/workflow-drafts';
import type { ApiError } from '@/services/api/api-error';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { Button } from '@/components/ui/Button/Button';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { formatDateTime } from '@/lib/format-date-time';
import { useDeleteDraft } from '../../hooks/useDeleteDraft';
import { useSaveDraft } from '../../hooks/useSaveDraft';
import { useValidateDraft } from '../../hooks/useValidateDraft';
import { parseWorkflowDocument } from '../../utils/parse-workflow-document';
import { DeleteDraftAction } from './DeleteDraftAction';
import { JsonEditor } from './JsonEditor';
import { ValidationResult, type ValidationOutcome } from './ValidationResult';

export interface DraftHeaderSlots {
  /** The draft's label, once it is read. */
  name?: string | null;
  actions?: ReactNode;
  note?: ReactNode;
}

export interface DraftEditorProps {
  workflowId: string;
  version: number;
  /** The page's header, handed the editor's actions and note: they live with the editor's state. */
  renderHeader: (slots: DraftHeaderSlots) => ReactElement;
}

/** Two spaces, the shape a hand-written workflow file has. */
const JSON_INDENT = 2;

const NOT_DRAFT_CODE: WorkflowDraftErrorCode = 'WORKFLOW_VERSION_NOT_DRAFT';

/** The refusal on a draft read that has its own wording instead of the generic load failure. */
function readFailureMessage(error: ApiError): string | null {
  if (error.status === HttpStatusCode.NotFound) {
    return 'This draft no longer exists.';
  }
  return readDraftError(error)?.code === NOT_DRAFT_CODE
    ? 'This version is no longer a draft.'
    : null;
}

/** `/workflows/:workflowId?version=N` for a draft: the stored document in a JSON editor, with its write actions. */
export function DraftEditor({ workflowId, version, renderHeader }: DraftEditorProps): ReactElement {
  const {
    data: draft,
    error,
    isError,
    refetch,
  } = useQuery(workflowQueries.document(workflowId, version));
  const validateMutation = useValidateDraft();
  const saveMutation = useSaveDraft(workflowId, version);
  const deleteMutation = useDeleteDraft(workflowId, version);
  // `null` means the editor shows the saved document untouched.
  const [edited, setEdited] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ValidationOutcome | null>(null);

  if (draft === undefined) {
    const failure = isError ? readFailureMessage(error) : null;

    return (
      <>
        {renderHeader({})}
        {isError && failure === null ? (
          <div className="flex flex-col items-start gap-4 p-8">
            <StatusRegion>{`Unable to load this draft: ${error.message}`}</StatusRegion>
            <Button variant="secondary" size="md" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <StatusRegion className="px-8 py-6">{failure ?? 'Loading draft…'}</StatusRegion>
        )}
      </>
    );
  }

  const saved = JSON.stringify(draft.document, null, JSON_INDENT);
  const text = edited ?? saved;
  const dirty = edited !== null && edited !== saved;
  const busy = validateMutation.isPending || saveMutation.isPending || deleteMutation.isPending;

  function handleChange(next: string): void {
    setEdited(next);
    setOutcome(null);
  }

  function handleDiscard(): void {
    setEdited(null);
    setOutcome(null);
  }

  function handleValidate(): void {
    const parsed = parseWorkflowDocument(text);
    if (!parsed.ok) {
      setOutcome({ kind: 'syntax', message: parsed.message });
      return;
    }
    validateMutation.mutate(parsed.document, {
      onSuccess: ({ stepCount }) => setOutcome({ kind: 'valid', stepCount }),
      onError: (failure) => setOutcome({ kind: 'invalid', error: failure }),
    });
  }

  function handleSave(): void {
    const parsed = parseWorkflowDocument(text);
    if (!parsed.ok) {
      setOutcome({ kind: 'syntax', message: parsed.message });
      return;
    }
    // Edits typed while the save was in flight stay; only the text that was sent is settled.
    const sent = text;
    saveMutation.mutate(parsed.document, {
      onSuccess: (draft) => {
        // A moved draft remounts the editor under its new key, so there is nothing to settle here.
        if (draft.workflowId === workflowId && draft.version === version) {
          setEdited((current) => (current === sent ? null : current));
        }
      },
    });
  }

  const actions = (
    <>
      <Button variant="quiet" disabled={!dirty || busy} onClick={handleDiscard}>
        Discard
      </Button>
      <Button variant="outline" disabled={busy} onClick={handleValidate}>
        {validateMutation.isPending ? 'Validating…' : 'Validate'}
      </Button>
      <Button variant="outline" disabled={!dirty || busy} onClick={handleSave}>
        {saveMutation.isPending ? 'Saving…' : 'Save draft'}
      </Button>
      <DeleteDraftAction disabled={busy} onConfirm={() => deleteMutation.mutate()} />
    </>
  );

  return (
    <>
      {renderHeader({
        name: draft.name,
        actions,
        note: dirty ? (
          <span className="text-fg-1">Unsaved changes</span>
        ) : (
          `Editing · draft saved ${formatDateTime(draft.updatedAt)}`
        ),
      })}
      <div className="flex min-h-0 flex-1 flex-col">
        <JsonEditor value={text} onChange={handleChange} label="Workflow document (JSON)" />
        <ValidationResult outcome={outcome} />
      </div>
    </>
  );
}
