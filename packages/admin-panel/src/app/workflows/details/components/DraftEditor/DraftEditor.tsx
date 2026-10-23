import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import type { ApiError } from '@/services/api/api-error';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { WORKFLOW_VERSION_STATUS } from '@/api/workflows/workflow-versions';
import { Button } from '@/components/ui/Button/Button';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { formatDateTime } from '@/lib/format-date-time';
import { useDeleteDraft } from '../../hooks/useDeleteDraft';
import { usePublishDraft } from '../../hooks/usePublishDraft';
import { useSaveDraft } from '../../hooks/useSaveDraft';
import { useValidateDraft } from '../../hooks/useValidateDraft';
import { useWorkflowDetailsSearchParams } from '../../hooks/useWorkflowDetailsSearchParams';
import { JSON_INDENT } from '../../constants/json-indent';
import { describePublishConnectorNotes } from '../../utils/describe-publish-connector-notes';
import { parseWorkflowDocument } from '../../utils/parse-workflow-document';
import { DeleteDraftAction } from './DeleteDraftAction';
import { DraftGraph } from './DraftGraph';
import { JsonEditor } from '../JsonEditor';
import { VersionTabs } from '../VersionTabs/VersionTabs';
import { PublishDraftDialog } from './PublishDraftDialog';
import { UnsavedChangesGuard } from './UnsavedChangesGuard';
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

/** The refusal on a draft read that has its own wording instead of the generic load failure. */
function readFailureMessage(error: ApiError): string | null {
  return error.status === HttpStatusCode.NotFound ? 'This draft no longer exists.' : null;
}

/** `/workflows/:workflowId?version=N` for a draft: the stored document as JSON or as a graph, with its write actions. */
export function DraftEditor({ workflowId, version, renderHeader }: DraftEditorProps): ReactElement {
  const {
    data: draft,
    error,
    isError,
    refetch,
  } = useQuery(workflowQueries.document(workflowId, version));
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const { data: pinnedDefinition } = useQuery({
    ...workflowQueries.detail(workflowId, version),
    enabled: isPublishModalOpen,
  });
  const validateMutation = useValidateDraft();
  const saveMutation = useSaveDraft(workflowId, version);
  const deleteMutation = useDeleteDraft(workflowId, version);
  const publishMutation = usePublishDraft(workflowId, version);
  const { view, step, setView, setStep } = useWorkflowDetailsSearchParams();
  // `null` means the editor shows the saved document untouched.
  const [edited, setEdited] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ValidationOutcome | null>(null);
  // Bumped on every edit, so a compile that was sent for older text is dropped when it lands.
  const textRevision = useRef(0);
  // The revision a compile is in flight for, so a repeated request for the same text is dropped.
  const compilingRevision = useRef<number | null>(null);
  const queryClient = useQueryClient();
  // Published or retired since the versions list was read: refetching it moves the page to the read-only view.
  const isNoLongerDraft = draft !== undefined && draft.status !== WORKFLOW_VERSION_STATUS.draft;

  useEffect(() => {
    if (isNoLongerDraft) {
      void queryClient.invalidateQueries({
        queryKey: workflowQueries.versions(workflowId).queryKey,
      });
    }
  }, [isNoLongerDraft, queryClient, workflowId]);

  if (isNoLongerDraft) {
    return (
      <>
        {renderHeader({})}
        <StatusRegion className="px-8 py-6">
          This version is no longer a draft. Opening it…
        </StatusRegion>
      </>
    );
  }

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

  const { document: storedDocument } = draft;
  const saved = JSON.stringify(storedDocument, null, JSON_INDENT);
  const text = edited ?? saved;
  const dirty = edited !== null && edited !== saved;
  const busy =
    validateMutation.isPending ||
    saveMutation.isPending ||
    deleteMutation.isPending ||
    publishMutation.isPending;

  function handleChange(next: string): void {
    textRevision.current += 1;
    setEdited(next);
    setOutcome(null);
  }

  function handleDiscard(): void {
    textRevision.current += 1;
    setEdited(null);
    setOutcome(null);
  }

  // Validate, Publish and the Graph tab share this: the result is kept only if the text has not changed since.
  function compileText(onValid?: () => void): void {
    const parsed = parseWorkflowDocument(text);
    if (!parsed.ok) {
      setOutcome({ kind: 'syntax', message: parsed.message });
      return;
    }
    const sentRevision = textRevision.current;
    const isCurrent = (): boolean => textRevision.current === sentRevision;
    compilingRevision.current = sentRevision;
    validateMutation.mutate(parsed.document, {
      onSettled: () => {
        if (compilingRevision.current === sentRevision) {
          compilingRevision.current = null;
        }
      },
      onSuccess: ({ stepCount, workflow }) => {
        if (isCurrent()) {
          setOutcome({ kind: 'valid', stepCount, workflow });
          onValid?.();
        }
      },
      onError: (failure) => {
        if (isCurrent()) {
          setOutcome({ kind: 'invalid', error: failure });
        }
      },
    });
  }

  // The Graph tab's request: a compile already in flight for this text is not sent twice (Strict Mode runs effects twice).
  function compileForGraph(): void {
    if (compilingRevision.current !== textRevision.current) {
      compileText();
    }
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

  // A save never compiles, so a saved draft can still be invalid; Publish is disabled while dirty, so `text` is the stored document.
  function handlePublish(): void {
    compileText(() => setIsPublishModalOpen(true));
  }

  function handleConfirmPublish(): void {
    publishMutation.mutate(undefined, { onError: () => setIsPublishModalOpen(false) });
  }

  const actions = (
    <>
      <Button variant="quiet" disabled={!dirty || busy} onClick={handleDiscard}>
        Discard
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => compileText()}>
        {validateMutation.isPending ? 'Validating…' : 'Validate'}
      </Button>
      <Button variant="outline" disabled={!dirty || busy} onClick={handleSave}>
        {saveMutation.isPending ? 'Saving…' : 'Save draft'}
      </Button>
      <Button variant="primary" disabled={busy || dirty} onClick={handlePublish}>
        Publish
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
          <span className="text-fg-1">Unsaved changes · save to publish</span>
        ) : (
          `Editing · draft saved ${formatDateTime(draft.updatedAt)}`
        ),
      })}
      <ValidationResult outcome={outcome} />
      <VersionTabs
        value={view ?? 'json'}
        onValueChange={setView}
        keepJsonMounted
        json={<JsonEditor value={text} onChange={handleChange} label="Workflow document (JSON)" />}
        graph={
          <DraftGraph
            workflowId={workflowId}
            outcome={outcome}
            requestedStep={step}
            onCompile={compileForGraph}
            onSelectStep={setStep}
            onShowJson={() => setView('json')}
            onRetry={() => setOutcome(null)}
          />
        }
      />
      <UnsavedChangesGuard when={dirty} />
      <PublishDraftDialog
        open={isPublishModalOpen}
        onOpenChange={setIsPublishModalOpen}
        workflowId={workflowId}
        name={draft.name}
        version={version}
        isPending={publishMutation.isPending}
        onConfirm={handleConfirmPublish}
        connectorNotes={pinnedDefinition ? describePublishConnectorNotes(pinnedDefinition) : []}
      />
    </>
  );
}
