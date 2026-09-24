import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { tv } from '@/lib/tv';

/** `outline` is the design's black-bordered action — Export, Next — not a louder `secondary`.
 *  `danger-outline` is the bordered red action (Reject); `danger` stays the borderless one Connectors uses. */
export type ButtonVariant =
  'primary' | 'secondary' | 'outline' | 'quiet' | 'danger' | 'danger-outline';

/** 28, 32, 40 and 48px tall. `lg` for a page's own actions, `sm` and `md` inside toolbars, `icon` for a square icon-only control, `xl` for the sign-in CTA. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const button = tv({
  base: 'inline-flex cursor-pointer items-center justify-center font-regular whitespace-nowrap transition-colors duration-base ease-default active:opacity-[.96] disabled:cursor-not-allowed',
  variants: {
    variant: {
      primary:
        'border-0 bg-tsh-black text-tsh-white enabled:hover:bg-tsh-ink-1 disabled:bg-fg-disabled disabled:text-tsh-white',
      secondary:
        'border border-border-strong bg-tsh-white text-tsh-black enabled:hover:border-tsh-black enabled:hover:bg-tsh-black enabled:hover:text-tsh-white disabled:border-fg-disabled disabled:bg-transparent disabled:text-fg-disabled',
      outline:
        'border border-tsh-black bg-transparent text-tsh-black enabled:hover:bg-tsh-black enabled:hover:text-tsh-white disabled:border-fg-disabled disabled:text-fg-disabled',
      quiet:
        'border-0 bg-transparent text-fg-3 enabled:hover:bg-bg-subtle enabled:hover:text-fg-2 disabled:text-fg-disabled',
      danger:
        'border-0 bg-transparent text-tsh-red enabled:hover:bg-bg-subtle enabled:hover:text-tsh-red disabled:text-fg-disabled',
      'danger-outline':
        'border border-tsh-red bg-transparent text-tsh-red enabled:hover:bg-tsh-red enabled:hover:text-tsh-white disabled:border-fg-disabled disabled:text-fg-disabled',
    },
    size: {
      sm: 'h-7 gap-1.5 px-2.5 text-caps-tiny',
      md: 'h-8 gap-1.5 px-3 text-caps-tiny',
      lg: 'h-10 gap-3 px-5 text-body-sm',
      xl: 'h-12 gap-3 px-5 text-body-sm',
      icon: 'size-10 px-0',
    },
  },
  /* The design pads primary wider and secondary narrower than `lg`'s own padding, and `quiet` narrowly at any size. */
  compoundVariants: [
    { variant: 'primary', size: 'lg', class: 'px-6' },
    { variant: 'secondary', size: 'lg', class: 'px-4' },
    { variant: 'quiet', class: 'px-3' },
    { variant: 'danger', class: 'px-3' },
  ],
  defaultVariants: { variant: 'secondary', size: 'lg' },
});

export function Button({
  variant,
  size,
  type = 'button',
  className,
  ...rest
}: ButtonProps): ReactElement {
  return <button type={type} className={button({ variant, size, className })} {...rest} />;
}
