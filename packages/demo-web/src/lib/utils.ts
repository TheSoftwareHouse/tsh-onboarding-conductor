import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Builds a class attribute: `clsx` flattens conditionals, `tailwind-merge` drops conflicts. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
