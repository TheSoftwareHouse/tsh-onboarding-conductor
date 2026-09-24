import type { HTMLAttributes, ReactElement } from 'react';
import { tv } from '@/lib/tv';

/**
 * `strong` is a settled state — the design has no green, so completed reads as filled black.
 * Amber waits on a person: `attention` pale for a queue, `active` solid for the item in hand.
 */
export type ChipTone =
  | 'neutral'
  | 'neutral-strong'
  | 'strong'
  | 'outline'
  | 'muted'
  | 'attention'
  | 'active'
  | 'info'
  | 'scheduled'
  | 'danger';

/** `badge` is today's field tag; `status` is the card's `Configured` pill (12px, tighter padding). */
export type ChipSize = 'badge' | 'status';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  size?: ChipSize;
}

const chip = tv({
  base: 'inline-flex items-center uppercase',
  variants: {
    tone: {
      neutral: 'bg-bg-alt text-fg-2',
      /** Same fill as `neutral`, full-contrast text — for a badge that must read black, not grey. */
      'neutral-strong': 'bg-bg-alt text-tsh-black',
      strong: 'bg-tsh-black text-tsh-white',
      outline: 'border border-border-strong text-fg-3',
      muted: 'border border-border-strong text-fg-4',
      attention: 'bg-tsh-yellow-200 text-tsh-black',
      active: 'bg-tsh-yellow-400 text-tsh-black',
      info: 'bg-tsh-blue-100 text-tsh-black',
      scheduled: 'bg-tsh-purple-300 text-tsh-black',
      danger: 'border border-tsh-red text-tsh-red',
    },
    /* `badge` pairs `min-h-6` with padding so a long string wraps and breathes — `min-h-6` alone
       only centres one line. `status` is the card pill; `text-caps-tiny` bundles its tracking. */
    size: {
      badge: 'min-h-6 px-2.5 py-1 text-body-2xs tracking-caps',
      status: 'px-2 py-0.75 text-caps-tiny',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'badge' },
});

export function Chip({ tone, size, className, ...rest }: ChipProps): ReactElement {
  return <span className={chip({ tone, size, className })} {...rest} />;
}
