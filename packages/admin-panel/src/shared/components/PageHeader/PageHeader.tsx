import type { ReactElement, ReactNode } from 'react';
import { Typography } from '../Typography/Typography';

export interface PageHeaderProps {
  /** Line above the title naming where the page sits, such as the section group it belongs to. */
  eyebrow?: string;
  title: string;
  /** Controls shown opposite the title, such as an export or reload button. */
  children?: ReactNode;
}

/** A page's own header band: where the operator is, and the actions that page offers. */
export function PageHeader({ eyebrow, title, children }: PageHeaderProps): ReactElement {
  return (
    <header className="flex min-h-header flex-none flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-border-rule px-8 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow === undefined ? null : (
          <Typography variant="caps-tiny" className="text-fg-4">
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h5" as="h1">
          {title}
        </Typography>
      </div>
      {children === undefined ? null : (
        <div className="flex flex-none items-center gap-3">{children}</div>
      )}
    </header>
  );
}
