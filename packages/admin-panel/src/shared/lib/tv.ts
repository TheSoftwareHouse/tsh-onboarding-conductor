import { createTV } from 'tailwind-variants';
import { TAILWIND_MERGE_CONFIG } from './tailwind-merge-config';

/**
 * `tailwind-variants` bound to this project's merge config. Import this rather than the library's
 * own `tv`, which knows only Tailwind's scales — see `tailwind-merge-config.ts`.
 */
export const tv = createTV({ twMergeConfig: TAILWIND_MERGE_CONFIG });
