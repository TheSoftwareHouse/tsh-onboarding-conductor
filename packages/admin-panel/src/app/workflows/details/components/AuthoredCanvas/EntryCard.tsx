import type { ReactElement, ReactNode } from 'react';
import { GroupDepthContext } from './group-depth';

export interface EntryCardProps {
  /** The title row: an `EntryTitle` or a name input, with its actions; a hairline sets it off. */
  header?: ReactNode;
  children: ReactNode;
  role?: string;
  'aria-label'?: string;
}

/** One entry of a list the author adds to: white and bordered, so it stands out on a group's tint. */
export function EntryCard({
  header,
  children,
  role,
  'aria-label': ariaLabel,
}: EntryCardProps): ReactElement {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className="flex flex-col border border-border-rule bg-bg-page"
    >
      {header !== undefined && (
        <div className="flex items-center justify-between gap-2 border-b border-border-hair px-3 py-2">
          {header}
        </div>
      )}
      <GroupDepthContext.Provider value={0}>
        <div className="flex flex-col gap-3 p-3">{children}</div>
      </GroupDepthContext.Provider>
    </div>
  );
}
