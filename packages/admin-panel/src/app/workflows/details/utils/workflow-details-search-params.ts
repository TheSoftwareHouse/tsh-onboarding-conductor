import { parseAsStringLiteral, type inferParserType } from 'nuqs';
import { parseAsTrimmedString } from '@/lib/search-params';
import { workflowVersionSearchParams } from '@/lib/workflow-search-params';

export const WORKFLOW_VIEWS = ['graph', 'json'] as const;

export type WorkflowView = (typeof WORKFLOW_VIEWS)[number];

/** One nuqs parser per URL key; both are shareable and a bad value falls back to `null`. */
export const workflowDetailsSearchParams = {
  ...workflowVersionSearchParams,
  step: parseAsTrimmedString,
  view: parseAsStringLiteral(WORKFLOW_VIEWS),
};

export type WorkflowDetailsSearchValues = inferParserType<typeof workflowDetailsSearchParams>;

/** The list's own search string, with this page's `version`, `step` and `view` stripped, for the back link. */
export function stripDetailsParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('version');
  params.delete('step');
  params.delete('view');
  const remaining = params.toString();
  return remaining === '' ? '' : `?${remaining}`;
}
