import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { Td } from '@/components/ui/DataTable/DataTable';
import { ArrowForward } from '@/components/ui/icons';
import { TextLink } from '@/components/ui/TextLink/TextLink';
import { ADMIN_ROUTES } from '@/constants/routes';
import { formatDate } from '@/lib/format-date-time';
import { serializeOnboardingWorkflowSearch } from '@/lib/onboarding-search-params';

export interface WorkflowTableRowProps {
  record: AdminWorkflowSummary;
}

/** `updatedAt` only ever moves on create or rename, so a different calendar date is worth a note. */
function wasEditedAfterCreation(record: AdminWorkflowSummary): boolean {
  return formatDate(record.createdAt) !== formatDate(record.updatedAt);
}

/** One row across the agreed columns; the identifier stays a `<Link>` so it is middle-clickable. */
export function WorkflowTableRow({ record }: WorkflowTableRowProps): ReactElement {
  // Carries the list's search string so Back restores the filtered list.
  const { search } = useLocation();
  const detailsTarget = { pathname: ADMIN_ROUTES.workflows.details(record.workflowId), search };
  const onboardingsHref = `${ADMIN_ROUTES.onboardings.root}${serializeOnboardingWorkflowSearch({ workflowId: record.workflowId })}`;

  return (
    <tr className="hover:bg-bg-subtle">
      <Td className="w-2/5 max-w-0">
        <div className="flex min-w-0 flex-col gap-0.5 leading-tight">
          <Link to={detailsTarget} className="truncate font-mono text-mono text-fg-1">
            {record.workflowId}
          </Link>
          {record.name !== null && (
            <span className="truncate text-body-sm leading-tight text-fg-3">{record.name}</span>
          )}
        </div>
      </Td>
      <Td variant="mono" className="text-caps-tiny font-normal tracking-normal text-fg-3">
        {record.scope}
      </Td>
      <Td variant="nowrap">
        {record.servingVersion === null ? (
          <span className="text-body-sm text-tsh-gray-400">Not served</span>
        ) : (
          <span className="font-mono text-mono text-fg-1">v{record.servingVersion}</span>
        )}
      </Td>
      <Td variant="nowrap">
        <span className="inline-flex items-baseline gap-2">
          <span className="font-mono text-mono text-fg-2">{record.versionCount}</span>
          {record.draftCount > 0 && (
            <span className="text-caps-tiny text-fg-4">{record.draftCount} draft</span>
          )}
        </span>
      </Td>
      <Td variant="end">
        {record.inProgressCount === 0 ? (
          <span className="text-tsh-gray-400">—</span>
        ) : (
          <TextLink
            to={onboardingsHref}
            variant="mono"
            title="Onboardings filtered to this workflow"
          >
            {record.inProgressCount}
          </TextLink>
        )}
      </Td>
      <Td variant="nowrap">
        <div className="flex flex-col gap-0.5 leading-tight">
          <span>{formatDate(record.createdAt)}</span>
          {wasEditedAfterCreation(record) && (
            <span className="text-fg-4">Edited {formatDate(record.updatedAt)}</span>
          )}
        </div>
      </Td>
      <Td variant="end">
        <Link
          to={detailsTarget}
          aria-label={`Open workflow ${record.workflowId}`}
          className="inline-flex"
        >
          <ArrowForward aria-hidden className="size-4.5 text-tsh-gray-400" />
        </Link>
      </Td>
    </tr>
  );
}
