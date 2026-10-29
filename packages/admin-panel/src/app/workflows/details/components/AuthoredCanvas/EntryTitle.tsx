import type { ReactElement, ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';

/** The title of a card in an inspector section: a transition, an arm, a list entry, an included section. */
export function EntryTitle({ children }: { children: ReactNode }): ReactElement {
  return (
    <Typography variant="mono" as="span" className="text-body-sm font-medium text-fg-1">
      {children}
    </Typography>
  );
}
