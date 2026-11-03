import type { ReactElement } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { ConnectorCard, type ConnectorCardProps } from './ConnectorCard/ConnectorCard';

const GROUP_DESCRIPTION =
  "Adapters are declared in code and discovered at start. Required settings come from each adapter's schema.";

export interface ConnectorListProps {
  /** The selected group's raw type. */
  type: string;
  /** The selected group's label. */
  label: string;
  cards: ConnectorCardProps[];
}

/**
 * Renders the selected type: heading, standing description, then its cards in one column. Grouping
 * is `groupConnectorsByType`'s job — this only ever sees the group `ConnectorsPage` picked.
 */
export function ConnectorList({ type, label, cards }: ConnectorListProps): ReactElement {
  const headingId = `connectors-type-heading-${type}`;

  return (
    <section aria-labelledby={headingId} className="flex max-w-detail flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Typography variant="h6" as="h2" id={headingId}>
          {label}
        </Typography>
        <Typography variant="body-md" className="text-fg-3">
          {GROUP_DESCRIPTION}
        </Typography>
      </header>
      {cards.map((card) => (
        <ConnectorCard key={card.connector.id} {...card} />
      ))}
    </section>
  );
}
