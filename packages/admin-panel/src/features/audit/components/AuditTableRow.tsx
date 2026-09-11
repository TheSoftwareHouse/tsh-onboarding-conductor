import type { ReactElement } from 'react';
import { Td } from '@/shared/components/DataTable/DataTable';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { describeAuditActorType, type AuditEvent } from '../types/audit-event';
import { AuditMetadata } from './AuditMetadata';

export interface AuditTableRowProps {
  event: AuditEvent;
}

/** Renders one audit trail entry across the seven displayed columns. */
export function AuditTableRow({ event }: AuditTableRowProps): ReactElement {
  return (
    <tr>
      <Td variant="nowrap">{formatDateTime(event.occurredAt)}</Td>
      <Td variant="nowrap" className="text-fg-2">
        {describeAuditActorType(event.actorType)}
      </Td>
      <Td variant="nowrap" className="text-fg-2">
        {event.actorId}
      </Td>
      <Td variant="nowrap" className="text-fg-2">
        {event.action}
      </Td>
      <Td variant="nowrap" className="text-fg-2">
        {event.resourceType}
      </Td>
      <Td variant="nowrap" className="text-fg-2">
        {event.resourceId}
      </Td>
      <Td variant="wrap" className="min-w-88">
        <AuditMetadata metadata={event.metadata} />
      </Td>
    </tr>
  );
}
