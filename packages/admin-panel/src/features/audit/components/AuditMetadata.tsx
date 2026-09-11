import { Fragment, type ReactElement } from 'react';
import { NOT_SET } from '@/shared/lib/format-date-time';

export interface AuditMetadataProps {
  metadata: Record<string, unknown>;
  action: string;
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
 * Renders an audit event's metadata as `key: value` pairs, joined inline with ` · `.
 *
 * Metadata carries a different shape per action — a lifecycle transition, a webhook delivery and
 * an admin access decision share no fields — so it cannot be spread across fixed table columns.
 * A definition list keeps every key readable without the panel having to know any of them; only
 * the layout is inline rather than a grid.
 *
 * `connector_settings.*` metadata genuinely records only key names — the engine never logs the
 * values — so those rows carry a note saying so rather than implying the values were just empty.
 */
export function AuditMetadata({ metadata, action }: AuditMetadataProps): ReactElement {
  const entries = Object.entries(metadata);

  if (entries.length === 0) {
    return <span>{NOT_SET}</span>;
  }

  return (
    <dl className="inline font-mono text-caps-tiny font-normal tracking-normal text-fg-3">
      {entries.map(([key, value], index) => (
        <Fragment key={key}>
          {index > 0 ? ' · ' : null}
          <dt className="inline">{key}</dt>
          {': '}
          <dd className="inline">{formatMetadataValue(value)}</dd>
        </Fragment>
      ))}
      {action.startsWith('connector_settings.') ? (
        <span className="text-tsh-gray-400"> (values never logged)</span>
      ) : null}
    </dl>
  );
}
