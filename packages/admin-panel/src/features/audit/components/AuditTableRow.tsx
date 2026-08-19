import type { ReactElement } from 'react';
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
      <td className="timestamp">{formatDateTime(event.occurredAt)}</td>
      <td className="identifier">{describeAuditActorType(event.actorType)}</td>
      <td className="identifier">{event.actorId}</td>
      <td className="identifier">{event.action}</td>
      <td className="identifier">{event.resourceType}</td>
      <td className="identifier">{event.resourceId}</td>
      <td className="metadata">
        <AuditMetadata metadata={event.metadata} />
      </td>
    </tr>
  );
}
