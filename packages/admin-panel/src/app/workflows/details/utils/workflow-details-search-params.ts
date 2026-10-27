import { createParser, createSerializer, type inferParserType } from 'nuqs';
import { parseAsTrimmedString } from '@/lib/search-params';
import { workflowVersionSearchParams } from '@/lib/workflow-search-params';

export const WORKFLOW_VIEWS = ['authored', 'compiled', 'json'] as const;

export type WorkflowView = (typeof WORKFLOW_VIEWS)[number];

/** Old links carry `?view=graph`, the compiled graph's former name. */
const LEGACY_VIEWS = new Map<string, WorkflowView>([['graph', 'compiled']]);

const parseAsWorkflowView = createParser<WorkflowView>({
  parse: (value) =>
    WORKFLOW_VIEWS.find((view) => view === value) ?? LEGACY_VIEWS.get(value) ?? null,
  serialize: (value) => value,
});

/** One nuqs parser per URL key; both are shareable and a bad value falls back to `null`. */
export const workflowDetailsSearchParams = {
  ...workflowVersionSearchParams,
  step: parseAsTrimmedString,
  view: parseAsWorkflowView,
};

export type WorkflowDetailsSearchValues = inferParserType<typeof workflowDetailsSearchParams>;

/** `search` with the given details params written over it; `null` removes a key, other keys stay. */
export const serializeDetailsSearch = createSerializer(workflowDetailsSearchParams);

/** The list's own search string, with this page's `version`, `step` and `view` stripped, for the back link. */
export function stripDetailsParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('version');
  params.delete('step');
  params.delete('view');
  const remaining = params.toString();
  return remaining === '' ? '' : `?${remaining}`;
}
