import type { HTMLAttributes, ReactElement } from 'react';
import { tv } from '../../lib/tv';

/**
 * `strong` is a settled state — the design has no green, so completed reads as filled black.
 * Amber waits on a person: `attention` pale for a queue, `active` solid for the item in hand.
 */
export type ChipTone =
  | 'neutral'
  | 'strong'
  | 'outline'
  | 'muted'
  | 'attention'
  | 'active'
  | 'info'
  | 'scheduled'
  | 'danger';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
}

const chip = tv({
  /* The system's tag, but `min-h-6` rather than a fixed height so a long string wraps. */
  base: 'inline-flex min-h-6 items-center px-2.5 text-caps-tiny uppercase',
  variants: {
    tone: {
      neutral: 'bg-bg-alt text-fg-2',
      strong: 'bg-tsh-black text-tsh-white',
      outline: 'border border-border-strong text-fg-3',
      muted: 'border border-border-strong text-fg-4',
      attention: 'bg-tsh-yellow-200 text-tsh-black',
      active: 'bg-tsh-yellow-400 text-tsh-black',
      info: 'bg-tsh-blue-100 text-tsh-black',
      scheduled: 'bg-tsh-purple-300 text-tsh-black',
      danger: 'border border-tsh-red text-tsh-red',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Chip({ tone, className, ...rest }: ChipProps): ReactElement {
  return <span className={chip({ tone, className })} {...rest} />;
}
