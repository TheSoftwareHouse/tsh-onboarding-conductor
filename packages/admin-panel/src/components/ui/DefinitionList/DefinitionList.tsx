import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';

/** `mono` backs the Scores flavour; `plain` backs the Collected-data labels. */
export type DefinitionListTermVariant = 'plain' | 'mono';

export interface DefinitionListEntry {
  term: ReactNode;
  description: ReactNode;
  key: string;
}

export interface DefinitionListProps {
  entries: readonly DefinitionListEntry[];
  termVariant?: DefinitionListTermVariant;
  className?: string;
}

const TERM_STYLES: Record<
  DefinitionListTermVariant,
  { typography: 'body-sm' | 'mono'; color: string }
> = {
  plain: { typography: 'body-sm', color: 'text-fg-4' },
  mono: { typography: 'mono', color: 'text-fg-3' },
};

/** Two-column `dl` grid. Entries are a prop, not children, so a caller cannot nest and break the grid. */
export function DefinitionList({
  entries,
  termVariant = 'plain',
  className,
}: DefinitionListProps): ReactElement {
  const term = TERM_STYLES[termVariant];

  return (
    <dl className={cn('grid grid-cols-[minmax(200px,max-content)_minmax(0,1fr)]', className)}>
      {entries.map((entry, index) => {
        const rule = index > 0 && 'border-t border-border-hair';

        return (
          <Fragment key={entry.key}>
            <Typography
              as="dt"
              variant={term.typography}
              className={cn('py-3 pr-6', term.color, rule)}
            >
              {entry.term}
            </Typography>
            <dd className={cn('m-0 py-3 wrap-anywhere', rule)}>{entry.description}</dd>
          </Fragment>
        );
      })}
    </dl>
  );
}
