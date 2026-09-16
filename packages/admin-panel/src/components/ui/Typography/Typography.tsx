import type { ElementType, HTMLAttributes, ReactElement } from 'react';
import { tv } from '@/lib/tv';

/** The design system's named type styles, one variant per `.tsh-*` class. */
export type TypographyVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'body-lg'
  | 'body-md'
  | 'body-sm'
  | 'caption'
  | 'caps-bigger'
  | 'caps-medium'
  | 'caps-regular'
  | 'caps-small'
  | 'caps-tiny'
  | 'mono';

export interface TypographyProps extends HTMLAttributes<HTMLElement> {
  variant?: TypographyVariant;
  /** Overrides the element the variant renders by default. */
  as?: ElementType;
}

const typography = tv({
  variants: {
    variant: {
      h1: 'font-display text-h1 text-fg-1',
      h2: 'font-display text-h2 text-fg-1',
      h3: 'font-display text-h3 text-fg-1',
      h4: 'font-display text-h4 text-fg-1',
      h5: 'font-display text-h5 text-fg-1',
      h6: 'font-display text-h6 text-fg-1',
      'body-lg': 'font-body text-body-lg text-fg-2',
      'body-md': 'font-body text-body-md text-fg-2',
      'body-sm': 'font-body text-body-sm text-fg-3',
      caption: 'font-body text-caption text-fg-3',
      'caps-bigger': 'font-body text-caps-bigger text-fg-1 uppercase',
      'caps-medium': 'font-body text-caps-medium text-fg-1 uppercase',
      'caps-regular': 'font-body text-caps-regular text-fg-1 uppercase',
      'caps-small': 'font-body text-caps-small text-fg-2 uppercase',
      'caps-tiny': 'font-body text-caps-tiny text-fg-2 uppercase',
      mono: 'font-mono text-mono text-fg-2',
    },
  },
  defaultVariants: { variant: 'body-md' },
});

const DEFAULT_ELEMENT: Record<TypographyVariant, ElementType> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  'body-lg': 'p',
  'body-md': 'p',
  'body-sm': 'p',
  caption: 'p',
  'caps-bigger': 'span',
  'caps-medium': 'span',
  'caps-regular': 'span',
  'caps-small': 'span',
  'caps-tiny': 'span',
  mono: 'span',
};

/**
 * Text in one of the design system's styles. The variant picks the element too, so a heading is a
 * heading unless `as` says otherwise.
 */
export function Typography({
  variant = 'body-md',
  as,
  className,
  ...rest
}: TypographyProps): ReactElement {
  const Tag = as ?? DEFAULT_ELEMENT[variant];

  return <Tag className={typography({ variant, className })} {...rest} />;
}
