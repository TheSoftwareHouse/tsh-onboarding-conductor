import type { ReactElement } from 'react';
import { groupConnectorsByType } from '../utils/group-connectors-by-type';
import { ConnectorCard, type ConnectorCardProps } from './ConnectorCard';

export interface ConnectorListProps {
  statusMessage: string;
  emptyMessage: string;
  /**
   * One fully-bound prop set per connector — the page owns the draft state and the write
   * callbacks, and hands each card its own slice, so this component stays a plain list renderer.
   */
  cards: ConnectorCardProps[];
}

/**
 * The polite live-region status line, then the cards grouped by what each connector does, or the
 * empty message.
 *
 * Grouping is the only reason this component knows about capabilities: a flat list of thirteen
 * providers reads as an undifferentiated wall, and `type` exists precisely so an operator can find
 * "the email one" without opening each card.
 */
export function ConnectorList({
  statusMessage,
  emptyMessage,
  cards,
}: ConnectorListProps): ReactElement {
  const groups = groupConnectorsByType(cards);

  return (
    <>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {groups.length === 0 ? (
        <p className="status-region">{emptyMessage}</p>
      ) : (
        groups.map((group) => (
          <section
            className="connector-group"
            key={group.type}
            aria-labelledby={`connector-group-${group.type}`}
          >
            <h2 className="connector-group__heading" id={`connector-group-${group.type}`}>
              {group.label}
            </h2>
            <div className="connector-list">
              {group.cards.map((card) => (
                <ConnectorCard key={card.connector.id} {...card} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
