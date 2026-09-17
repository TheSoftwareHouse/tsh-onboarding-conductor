import type { ConnectorCardProps } from './ConnectorCard/ConnectorCard';
import { CONNECTOR_TYPES, describeConnectorType } from '../../types/connector';

export interface ConnectorTypeGroup {
  type: string;
  label: string;
  cards: ConnectorCardProps[];
}

/**
 * Buckets the cards by what each connector does, so an operator scanning for "the email one" reads
 * a heading instead of every card.
 *
 * Groups follow `CONNECTOR_TYPES` order and an empty group is dropped, so the page shows only
 * capabilities that something actually implements. A type this build does not know — the engine
 * owns the set and may add to it — is kept and appended after the known ones rather than hidden,
 * because silently dropping a connector an operator has to configure is worse than an odd heading.
 * Card order within a group is the order the engine reported them.
 */
export function groupConnectorsByType(cards: ConnectorCardProps[]): ConnectorTypeGroup[] {
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

  return [...knownOrder, ...unknownTypes].flatMap((type) => {
    const groupCards = cardsByType.get(type);

    if (!groupCards) {
      return [];
    }

    return [{ type, label: describeConnectorType(type), cards: groupCards }];
  });
}
