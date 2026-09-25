import type { ReactElement } from 'react';
import type { AuditEvent } from '@/api/audit/audit-events';
import { Td } from '@/components/ui/DataTable/DataTable';
import { cn } from '@/lib/cn';
import { isFailureAuditAction } from '@/lib/audit-actions';
import { formatLogDateTime } from '@/lib/format-date-time';
import { describeAuditResourceType } from '../../../../utils/describe-audit-events';
import { AuditActorCell } from './AuditActorCell/AuditActorCell';
import { AuditMetadata } from './AuditMetadata/AuditMetadata';
import { AuditResourceCell } from './AuditResourceCell/AuditResourceCell';

export interface AuditTableRowProps {
  event: AuditEvent;
}

/** Renders one audit trail entry across the six displayed columns. */
export function AuditTableRow({ event }: AuditTableRowProps): ReactElement {
  return (
    <tr className="hover:bg-bg-subtle">
      <Td
        variant="mono"
        className="text-caps-tiny font-normal tracking-normal whitespace-nowrap text-fg-3"
      >
        {formatLogDateTime(event.occurredAt)}
      </Td>
      <Td variant="text">
        <AuditActorCell actorType={event.actorType} actorId={event.actorId} />
      </Td>
      <Td
        variant="mono"
        className={cn(
          'wrap-break-word',
          isFailureAuditAction(event.action) ? 'text-tsh-red' : 'text-fg-1',
        )}
      >
        {event.action}
      </Td>
      <Td variant="nowrap" className="text-fg-2">
        {describeAuditResourceType(event.resourceType)}
      </Td>
      <Td variant="mono" className="wrap-break-word">
        <AuditResourceCell resourceType={event.resourceType} resourceId={event.resourceId} />
      </Td>
      <Td variant="wrap">
        <AuditMetadata metadata={event.metadata} action={event.action} />
      </Td>
    </tr>
  );
}
