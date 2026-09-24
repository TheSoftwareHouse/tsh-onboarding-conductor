import type { ReactElement, ReactNode } from 'react';
import { Typography } from '../Typography/Typography';

export interface SectionHeaderProps {
  title: string;
  /** Short text beside the title, such as an item count. */
  meta?: ReactNode;
  /** A link or control pushed to the header's far edge. */
  trailing?: ReactNode;
}

/** A band's header: title, optional meta, and an optional trailing action, on a bottom hairline. */
export function SectionHeader({ title, meta, trailing }: SectionHeaderProps): ReactElement {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-3 border-b border-border-hair px-8 py-5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-4">
        <Typography variant="body-lg" as="h2" className="font-normal text-fg-1">
          {title}
        </Typography>
        {meta === undefined ? null : <Typography variant="body-sm">{meta}</Typography>}
      </div>
      {trailing === undefined ? null : (
        <div className="flex flex-none items-center">{trailing}</div>
      )}
    </header>
  );
}
