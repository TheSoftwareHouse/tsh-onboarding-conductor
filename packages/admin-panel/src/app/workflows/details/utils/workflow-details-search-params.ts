import { parseAsInteger, type inferParserType } from 'nuqs';
import { parseAsTrimmedString } from '@/lib/search-params';

/** One nuqs parser per URL key; both are shareable and a bad value falls back to `null`. */
export const workflowDetailsSearchParams = {
  version: parseAsInteger,
  step: parseAsTrimmedString,
};

export type WorkflowDetailsSearchValues = inferParserType<typeof workflowDetailsSearchParams>;

/** The list's own search string, with this page's `version` and `step` stripped, for the back link. */
export function stripDetailsParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('version');
  params.delete('step');
  const remaining = params.toString();
  return remaining === '' ? '' : `?${remaining}`;
}
