import type { ComponentPropsWithoutRef, ElementType, ReactElement } from 'react';
import { tv } from '@/lib/tv';

/** `outline` is the design's black-bordered action — Export, Next — not a louder `secondary`.
 *  `danger-outline` is the bordered red action (Reject); `danger` stays the borderless one Connectors uses. */
export type ButtonVariant =
  'primary' | 'secondary' | 'outline' | 'quiet' | 'danger' | 'danger-outline';

/** 28, 32, 40 and 48px tall. `lg` for a page's own actions, `sm` and `md` inside toolbars, `icon` for a square icon-only control, `xl` for the sign-in CTA. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

interface ButtonOwnProps<T extends ElementType> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders another element, such as a router `Link`, styled as a button. */
  as?: T;
}

export type ButtonProps<T extends ElementType = 'button'> = ButtonOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof ButtonOwnProps<T>>;

const button = tv({
  base: 'inline-flex cursor-pointer items-center justify-center font-regular whitespace-nowrap transition-colors duration-base ease-default active:opacity-[.96] disabled:cursor-not-allowed',
  variants: {
    variant: {
      primary:
        'border-0 bg-tsh-black text-tsh-white hover:not-disabled:bg-tsh-ink-1 disabled:bg-fg-disabled disabled:text-tsh-white',
      secondary:
        'border border-border-strong bg-tsh-white text-tsh-black hover:not-disabled:border-tsh-black hover:not-disabled:bg-tsh-black hover:not-disabled:text-tsh-white disabled:border-fg-disabled disabled:bg-transparent disabled:text-fg-disabled',
      outline:
        'border border-tsh-black bg-transparent text-tsh-black hover:not-disabled:bg-tsh-black hover:not-disabled:text-tsh-white disabled:border-fg-disabled disabled:text-fg-disabled',
      quiet:
        'border-0 bg-transparent text-fg-3 hover:not-disabled:bg-bg-subtle hover:not-disabled:text-fg-2 disabled:text-fg-disabled',
      danger:
        'border-0 bg-transparent text-tsh-red hover:not-disabled:bg-bg-subtle hover:not-disabled:text-tsh-red disabled:text-fg-disabled',
      'danger-outline':
        'border border-tsh-red bg-transparent text-tsh-red hover:not-disabled:bg-tsh-red hover:not-disabled:text-tsh-white disabled:border-fg-disabled disabled:text-fg-disabled',
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

export function Button<T extends ElementType = 'button'>({
  variant,
  size,
  as,
  className,
  ...rest
}: ButtonProps<T>): ReactElement {
  const Tag: ElementType = as ?? 'button';
  // Only a real button needs `type`; it defaults to `button` so one inside a form never submits by accident.
  const typeProps = Tag === 'button' ? { type: 'button' } : {};

  return <Tag {...typeProps} className={button({ variant, size, className })} {...rest} />;
}
