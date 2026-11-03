import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { ErrorState } from '@/components/ui/ErrorState/ErrorState';
import type { ApiError } from '@/services/api/api-error';

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const FALLBACK_BODY = 'Request failed.';

export interface LoadFailureProps {
  error: ApiError | null;
  /** Completes "Unable to load …" and "No access to …", e.g. "onboardings". */
  subject: string;
  /** When "No access to …" reads differently, e.g. "the audit log" beside "audit events". */
  deniedSubject?: string;
  layout?: 'page' | 'section';
  onRetry?: () => void;
  /** Shown for a 404; without it a 404 renders as `error`. */
  notFound?: { title: string; body: string; actions?: ReactNode };
  /** Appended to the error body, e.g. " The rest of this onboarding is up to date." */
  bodySuffix?: string;
  className?: string;
}

/** Maps a failed read onto an `ErrorState`. */
export function LoadFailure({
  error,
  subject,
  deniedSubject,
  layout = 'page',
  onRetry,
  notFound,
  bodySuffix = '',
  className,
}: LoadFailureProps): ReactElement {
  const status = error?.status;

  if (status === HTTP_FORBIDDEN) {
    return (
      <ErrorState
        kind="denied"
        layout={layout}
        className={className}
        title={`No access to ${deniedSubject ?? subject}`}
        body={error?.message}
      />
    );
  }

  if (status === HTTP_NOT_FOUND && notFound) {
    return (
      <ErrorState
        kind="notFound"
        layout={layout}
        className={className}
        title={notFound.title}
        body={notFound.body}
        actions={notFound.actions}
      />
    );
  }

  return (
    <ErrorState
      layout={layout}
      className={className}
      title={`Unable to load ${subject}`}
      body={`${error?.message ?? FALLBACK_BODY}${bodySuffix}`}
      actions={
        onRetry ? (
          <Button
            variant={layout === 'page' ? 'primary' : 'secondary'}
            size={layout === 'page' ? 'lg' : 'md'}
            onClick={() => onRetry()}
          >
            Retry
          </Button>
        ) : undefined
      }
    />
  );
}
