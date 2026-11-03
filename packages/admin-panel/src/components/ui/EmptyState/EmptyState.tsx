import type { ReactElement, ReactNode } from 'react';
import { Inbox, SearchOff } from '../icons';
import { StateLayout } from '../StateLayout';

export interface EmptyStateProps {
  /** `empty`: nothing exists yet. `noMatch`: filters or search exclude everything. */
  kind?: 'empty' | 'noMatch'; // default 'empty'
  layout?: 'page' | 'section'; // default 'page'
  title: string;
  body?: string;
  /** Buttons or links: in `page` a primary `lg` Button, in `section` a secondary `md` one. */
  actions?: ReactNode;
  className?: string;
}

/** A read that returned nothing, or whose filters exclude everything. */
export function EmptyState({ kind = 'empty', ...rest }: EmptyStateProps): ReactElement {
  return (
    <StateLayout
      {...rest}
      icon={kind === 'noMatch' ? SearchOff : Inbox}
      iconClassName="text-fg-1"
      role="status"
    />
  );
}
