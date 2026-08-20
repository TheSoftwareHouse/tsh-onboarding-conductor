/**
 * Publication state of a single stored revision. Every revision of a workflow
 * carries its own status, so the same workflow id can hold a published revision
 * serving traffic while a newer one is still being drafted.
 */
export type WorkflowStatus = 'draft' | 'published';

export const PUBLISHED_WORKFLOW_STATUS: WorkflowStatus = 'published';
