import type { ReactElement, ReactNode } from 'react';
import { Typography } from '@/components/ui/Typography/Typography';
import { Info } from '@/components/ui/icons';
import { tv } from '@/lib/tv';

const callout = tv({
  slots: {
    band: 'flex items-center gap-3',
    icon: 'size-4.5 shrink-0',
    text: '',
  },
  variants: {
    variant: {
      page: {
        band: 'flex-none border-b border-border-rule bg-bg-subtle px-8 py-4',
        icon: 'text-fg-3',
      },
      notice: {
        band: 'border border-tsh-yellow-500 bg-tsh-yellow-200 px-4 py-3',
        icon: 'text-fg-1',
        text: 'text-fg-1',
      },
    },
  },
  defaultVariants: { variant: 'page' },
});

export interface CalloutProps {
  children: ReactNode;
  /** `page` is the full-width band above a panel; `notice` a bordered, tinted band inside a form. */
  variant?: 'page' | 'notice';
  /** `status` makes a band that appears after load announce itself to a screen reader. */
  role?: 'status';
}

/** An info band: the Info icon beside body copy, as the design draws above a filter panel. */
export function Callout({ children, variant, role }: CalloutProps): ReactElement {
  const { band, icon, text } = callout({ variant });

  return (
    <div role={role} className={band()}>
      <Info aria-hidden="true" focusable="false" className={icon()} />
      <Typography variant="body-sm" className={text()}>
        {children}
      </Typography>
    </div>
  );
}
