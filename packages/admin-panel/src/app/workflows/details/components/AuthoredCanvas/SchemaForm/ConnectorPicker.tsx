import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CONNECTOR_TYPES, type ConnectorType } from '@tsh/ddl-schema/workflow-contract';
import { connectorQueries } from '@/api/connectors/connector-queries';
import { Input } from '@/components/ui/Input/Input';
import { Select } from '@/components/ui/Select/Select';
import { resolveSchema, type Schema } from '../../../utils/config-schema';
import { UNSET } from './form-values';

const CONNECTOR_TYPE_SET = new Set<unknown>(CONNECTOR_TYPES);

/** The capabilities a connector object accepts, read from its `type` enum; `null` when the object is no connector binding. */
export function readConnectorTypes(schema: Schema): ConnectorType[] | null {
  const id = schema.properties?.id;
  const type = schema.properties?.type ? resolveSchema(schema.properties.type) : undefined;
  if (id === undefined || type?.enum === undefined) return null;
  return type.enum.every((value) => CONNECTOR_TYPE_SET.has(value))
    ? (type.enum as ConnectorType[])
    : null;
}

export interface ConnectorPickerProps {
  /** Capabilities the slot accepts; the binding's own `type`, when set, narrows them to one. */
  types: ConnectorType[];
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  label: string;
}

/** A connector binding's `id`, picked from the engine's connectors of the capabilities the slot accepts. */
export function ConnectorPicker({
  types,
  value,
  onChange,
  readOnly,
  label,
}: ConnectorPickerProps): ReactElement {
  const { data: connectors, isPending, error } = useQuery(connectorQueries.list());
  const current = typeof value === 'string' ? value : UNSET;

  // Without the list there is nothing to pick from, so the id stays typeable.
  if (isPending || error !== null) {
    return (
      <Input
        font="mono"
        size="sm"
        aria-label={label}
        disabled={readOnly}
        placeholder={isPending ? 'Loading connectors…' : 'Connectors unavailable'}
        value={current}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const matching = connectors.filter((connector) => types.some((type) => type === connector.type));
  const isKnown = matching.some((connector) => connector.id === current);
  const items = [
    ...(current === UNSET ? [{ value: UNSET, label: 'Choose a connector' }] : []),
    ...(!isKnown && current !== UNSET
      ? [{ value: current, label: `${current} (not available)` }]
      : []),
    ...matching.map((connector) => ({
      value: connector.id,
      label: `${connector.name} · ${connector.id}${connector.configured ? '' : ' (not configured)'}`,
    })),
  ];

  return (
    <Select
      aria-label={label}
      items={items}
      value={current}
      disabled={readOnly}
      onValueChange={onChange}
    />
  );
}
