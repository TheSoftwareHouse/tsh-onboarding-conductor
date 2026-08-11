import { buildWorkflowJsonSchema } from './workflow-json-schema.builder';

/** The runtime contract, built once from the default registry. */
export const workflowJsonSchema = buildWorkflowJsonSchema();
