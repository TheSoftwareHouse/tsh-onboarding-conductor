import { Fragment, type ReactElement } from 'react';
import { NOT_SET } from '@/shared/lib/format-date-time';

export interface AuditMetadataProps {
  metadata: Record<string, unknown>;
}

/**
 * Renders one metadata value as a single line. Arrays are joined because the ones the engine
 * records (granted and required roles) read as lists, while a nested object keeps its JSON form
 * rather than being flattened into keys that would collide with the top-level ones.
 */
function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return NOT_SET;
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? NOT_SET : value.map(formatMetadataValue).join(', ');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Renders an audit event's metadata as labelled key/value pairs.
 *
 * Metadata carries a different shape per action — a lifecycle transition, a webhook delivery and
 * an admin access decision share no fields — so it cannot be spread across fixed table columns.
 * A definition list keeps every key readable without the panel having to know any of them.
 *
 * The pairs are emitted as direct children of the list, with no wrapper element, so that the
 * list's own grid lays them all out and every key shares one column sized to the widest key.
 */
export function AuditMetadata({ metadata }: AuditMetadataProps): ReactElement {
  const entries = Object.entries(metadata);

  if (entries.length === 0) {
    return <span>{NOT_SET}</span>;
  }

  return (
    <dl className="metadata-list">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd>{formatMetadataValue(value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
