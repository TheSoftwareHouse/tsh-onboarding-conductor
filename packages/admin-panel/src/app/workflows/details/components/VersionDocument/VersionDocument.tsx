import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button/Button';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { JSON_INDENT } from '../../constants/json-indent';
import { JsonEditor } from '../JsonEditor';

export interface VersionDocumentProps {
  workflowId: string;
  version: number;
}

/** A stored version's authored document, read-only, with a Copy JSON action; fetched once its tab mounts. */
export function VersionDocument({ workflowId, version }: VersionDocumentProps): ReactElement {
  const { data: stored, error, refetch } = useQuery(workflowQueries.document(workflowId, version));

  if (error !== null) {
    return (
      <div className="flex flex-col items-start gap-4 p-8">
        <StatusRegion>{`Unable to load the document: ${error.message}`}</StatusRegion>
        <Button variant="secondary" size="md" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (stored === undefined) {
    return <StatusRegion className="px-8 py-6">Loading document…</StatusRegion>;
  }

  const text = JSON.stringify(stored.document, null, JSON_INDENT);

  const handleCopy = (): void => {
    // `navigator.clipboard` is missing outside a secure context.
    if (navigator.clipboard === undefined) {
      showErrorToast('Unable to copy the JSON:', 'The clipboard is unavailable.');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => showSuccessToast('JSON copied.'),
      (failure: unknown) =>
        showErrorToast(
          'Unable to copy the JSON:',
          failure instanceof Error ? failure.message : 'The clipboard is unavailable.',
        ),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-8 py-3">
        <Button variant="secondary" size="md" onClick={handleCopy}>
          Copy JSON
        </Button>
      </div>
      <JsonEditor value={text} readOnly label="Workflow document (JSON, read-only)" />
    </div>
  );
}
