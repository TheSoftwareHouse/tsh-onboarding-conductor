import type { ConnectorCardProps } from './ConnectorCard/ConnectorCard';
import { CONNECTOR_TYPES, describeConnectorType } from '../../types/connector';

export interface ConnectorTypeGroup {
  type: string;
  label: string;
  cards: ConnectorCardProps[];
}

export interface GroupedConnectors {
  groups: ConnectorTypeGroup[];
  /** `CONNECTOR_TYPES` entries no connector reports, in declared order — the nav's "Not implemented" list. */
  notImplemented: string[];
}

/**
 * Buckets cards by capability, so an operator finds "the email one" without opening each card.
 * Groups follow `CONNECTOR_TYPES` order and an empty one is dropped. A type this build does not
 * know is appended rather than hidden — the engine owns the set, and silently dropping a connector
 * an operator must configure is worse than an odd heading.
 */
export function groupConnectorsByType(cards: ConnectorCardProps[]): GroupedConnectors {
  const cardsByType = new Map<string, ConnectorCardProps[]>();

  for (const card of cards) {
    const existing = cardsByType.get(card.connector.type);

    if (existing) {
      existing.push(card);
      continue;
    }

    cardsByType.set(card.connector.type, [card]);
  }

  // `CONNECTOR_TYPES` is the engine's own capability vocabulary, imported rather than restated;
  // its declaration order is the capability-first order this page groups by.
  const knownOrder: readonly string[] = CONNECTOR_TYPES;
  const unknownTypes = [...cardsByType.keys()].filter((type) => !knownOrder.includes(type));

  const groups = [...knownOrder, ...unknownTypes].flatMap((type) => {
    const groupCards = cardsByType.get(type);

    if (!groupCards) {
      return [];
    }

    return [{ type, label: describeConnectorType(type), cards: groupCards }];
  });

  // Only `CONNECTOR_TYPES` entries qualify: an unknown type is something a connector does
  // implement, just not something this build has a label for.
  const notImplemented = knownOrder.filter((type) => !cardsByType.has(type));

  return { groups, notImplemented };
}
