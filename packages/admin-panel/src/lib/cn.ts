import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { TAILWIND_MERGE_CONFIG } from './tailwind-merge-config';

const twMerge = extendTailwindMerge(TAILWIND_MERGE_CONFIG);

/**
 * Builds a class attribute: `clsx` flattens the conditionals, `tailwind-merge` drops the losing
 * side of a conflict — utilities all share one specificity, so attribute order decides nothing.
 *
 * For a component with variants use `tv` instead; it merges on the same config.
 */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
