export interface ValidationEditorProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  readOnly: boolean;
}

const BYTES_PER_KILOBYTE = 1024;
const KILOBYTES_PER_MEGABYTE = 1024;
export const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * KILOBYTES_PER_MEGABYTE;

/** A byte is under 1e-6 MB, so six decimals give back exactly the size that was typed. */
export const MEGABYTE_DECIMALS = 6;

/** A file's image dimensions apply only when every content type starts with this. */
export const IMAGE_CONTENT_TYPE_PREFIX = 'image/';

/** The select value standing for "no restriction". */
export const ANY = 'any';

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}
