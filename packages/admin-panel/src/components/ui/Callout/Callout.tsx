import type { ReactElement, ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { Info } from '@/components/ui/icons';

export interface CalloutProps {
  children: ReactNode;
}

/** Full-width info band: the Info icon beside body copy, as the design draws above a filter panel. */
export function Callout({ children }: CalloutProps): ReactElement {
  return (
    <div className="flex flex-none items-center gap-3 border-b border-border-rule bg-bg-subtle px-8 py-4">
      <Info aria-hidden="true" focusable="false" className="size-4.5 shrink-0 text-fg-3" />
      <Typography variant="body-sm">{children}</Typography>
    </div>
  );
}
