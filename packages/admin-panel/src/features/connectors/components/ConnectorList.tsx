import type { ReactElement } from 'react';
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

/** The polite live-region status line, one card per connector, or the empty message. */
export function ConnectorList({
  statusMessage,
  emptyMessage,
  cards,
}: ConnectorListProps): ReactElement {
  return (
    <>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {cards.length === 0 ? (
        <p className="status-region">{emptyMessage}</p>
      ) : (
        <div className="connector-list">
          {cards.map((card) => (
            <ConnectorCard key={card.connector.type} {...card} />
          ))}
        </div>
      )}
    </>
  );
}
