import type { InputHTMLAttributes, ReactElement, Ref } from 'react';
import { tv } from '@/lib/tv';

export type InputFont = 'text' | 'mono';
/** `md` is `h-10`, the panel's default control height; `sm` is `h-9`, `Pagination`'s page box. */
export type InputSize = 'md' | 'sm';

/** Omits the native `size` attribute (a character-width number), which this `size` shadows. */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  font?: InputFont;
  size?: InputSize;
}

/** Shared text-input shape: the panel's filter controls, and the connectors settings box. */
export const input = tv({
  base: 'w-full rounded-none border border-border-strong bg-bg-page px-3 text-fg-1 enabled:hover:border-tsh-black disabled:text-fg-disabled aria-invalid:border-tsh-red',
  variants: {
    font: {
      text: 'text-body-sm',
      mono: 'font-mono text-mono',
    },
    size: {
      md: 'h-10',
      sm: 'h-9',
    },
  },
  defaultVariants: { font: 'text', size: 'md' },
});

/** Forwards its ref to the `<input>`, because `react-hook-form`'s `register` returns one. */
export function Input({
  font,
  size,
  className,
  ref,
  ...rest
}: InputProps & { ref?: Ref<HTMLInputElement> }): ReactElement {
  return <input ref={ref} className={input({ font, size, className })} {...rest} />;
}
