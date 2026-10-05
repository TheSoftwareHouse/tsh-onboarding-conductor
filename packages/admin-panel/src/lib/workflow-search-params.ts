import { createSerializer, parseAsInteger, type inferParserType } from 'nuqs';

/** The version a link into a workflow's details pins, shared so it uses the page's own param name. */
export const workflowVersionSearchParams = {
  version: parseAsInteger,
};

export type WorkflowVersionSearchValues = inferParserType<typeof workflowVersionSearchParams>;

const serialize = createSerializer(workflowVersionSearchParams);

/** Query string opening a workflow's details at one version, '' when version is null. */
export function serializeWorkflowVersionSearch(values: WorkflowVersionSearchValues): string {
  return serialize(values);
}
