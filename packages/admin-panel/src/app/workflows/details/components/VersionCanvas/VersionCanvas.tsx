import { useMemo, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import { ErrorState } from '@/components/ui/ErrorState/ErrorState';
import { Loader } from '@/components/ui/Loader/Loader';
import { CANVAS_ERROR_TITLE } from '../../constants/canvas-error';
import { describeCanvasError } from '../../utils/describe-canvas-error';
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
    return <LoadFailure subject="the document" error={error} onRetry={() => void refetch()} />;
  }

  if (doc === null) {
    return <Loader label="Loading document…" />;
  }

  if (typeof doc === 'string') {
    return <ErrorState title={CANVAS_ERROR_TITLE} body={describeCanvasError(doc)} />;
  }

  return <AuthoredCanvas doc={doc} readOnly />;
}
