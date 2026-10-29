import { createContext } from 'react';
import { findStepType } from '@tsh/ddl-schema/step-types';
import type { ConnectorType } from '@tsh/ddl-schema/workflow-contract';
import { asObject, setMember } from './form-values';

/** The primary binding's resolved type, for its fallback entries; `null` outside a binding. */
export const PrimaryConnectorContext = createContext<{ type: ConnectorType | undefined } | null>(
  null,
);

/** The type a binding compiles with: its own `type`, else the slot's default, else the slot's only type. */
export function findConnectorType(
  binding: Record<string, unknown>,
  types: ConnectorType[],
  stepType: string | null,
): ConnectorType | undefined {
  const declared = types.find((type) => type === binding.type);
  if (declared !== undefined) return declared;
  const defaultType =
    stepType === null ? undefined : findStepType(stepType)?.connectorSlot?.defaultType;
  return defaultType ?? (types.length === 1 ? types[0] : undefined);
}

/** The binding with a new `type`; an adapter has one type, so a changed type drops every id in the chain. */
export function retypeConnector(
  binding: Record<string, unknown>,
  type: unknown,
  types: ConnectorType[],
  stepType: string | null,
): Record<string, unknown> {
  const next = setMember(binding, 'type', type);
  if (findConnectorType(next, types, stepType) === findConnectorType(binding, types, stepType)) {
    return next;
  }
  const fallback = Array.isArray(next.fallback)
    ? next.fallback.map((entry) =>
        setMember(setMember(asObject(entry), 'id', undefined), 'type', undefined),
      )
    : undefined;
  return setMember(setMember(next, 'fallback', fallback), 'id', undefined);
}
