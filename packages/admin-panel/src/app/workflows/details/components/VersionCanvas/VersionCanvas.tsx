import { useMemo, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { Button } from '@/components/ui/Button/Button';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { parseDocument } from '../../utils/authored-document';
import { AuthoredCanvas } from '../AuthoredCanvas/AuthoredCanvas';

export interface VersionCanvasProps {
  workflowId: string;
  version: number;
}

/** A stored version's authored document on a read-only canvas; fetched once its tab mounts. */
export function VersionCanvas({ workflowId, version }: VersionCanvasProps): ReactElement {
  const { data: stored, error, refetch } = useQuery(workflowQueries.document(workflowId, version));
  const doc = useMemo(
    () => (stored === undefined ? null : parseDocument(JSON.stringify(stored.document))),
    [stored],
  );

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

  if (doc === null) {
    return <StatusRegion className="px-8 py-6">Loading document…</StatusRegion>;
  }

  if (typeof doc === 'string') {
    return (
      <StatusRegion className="px-8 py-6">{`Unable to draw this version: ${doc}`}</StatusRegion>
    );
  }

  return <AuthoredCanvas doc={doc} readOnly />;
}
