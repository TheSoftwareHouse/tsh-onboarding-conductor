import type { ReactElement } from 'react';
import { Td } from '@/shared/components/DataTable/DataTable';
import { cn } from '@/shared/lib/cn';
import { formatLogDateTime } from '@/shared/lib/format-date-time';
import {
  describeAuditResourceType,
  isFailureAuditAction,
  type AuditEvent,
} from '../types/audit-event';
import { AuditActorCell } from './AuditActorCell';
import { AuditMetadata } from './AuditMetadata';
import { AuditResourceCell } from './AuditResourceCell';

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
