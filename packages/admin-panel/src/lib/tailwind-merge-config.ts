/**
 * The scales this project added to Tailwind's theme, so `tailwind-merge` can tell two of our
 * classes apart. Without `text`, it reads any unknown `text-*` as a colour and silently drops
 * `text-body-2xs` from `text-body-2xs text-tsh-black`.
 *
 * Keep in step with the `@theme` block in `src/app/tailwind.css`; a scale missed here fails
 * quietly.
 */
export const TAILWIND_MERGE_CONFIG = {
  extend: {
    theme: {
      text: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'body-lg',
        'body-md',
        'body-sm',
        'body-2xs',
        'body-lg-alt',
        'caption',
        'caps-bigger',
        'caps-medium',
        'caps-regular',
        'caps-small',
        'caps-tiny',
        'mono',
      ],
      spacing: ['header'],
      radius: ['0', 'xs', 'sm', 'chip'],
      tracking: ['caps'],
    },
    /* `duration` has no theme key, so the named values go on the class group itself; the id must
       stay `duration` or they never conflict with Tailwind's numeric `duration-200`. */
    classGroups: {
      duration: [{ duration: ['fast', 'base', 'slow'] }],
    },
  },
} as const;
