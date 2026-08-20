/**
 * Publication state of a single stored revision. Every revision of a workflow
 * carries its own status, so the same workflow id can hold a published revision
 * serving traffic while a newer one is still being drafted.
 *
 * `draft` is "not usable yet" and `retired` is "not usable any more": a retired
 * revision is discontinued outright, so it can neither start new onboardings nor
 * serve the ones already pinned to it.
 */
export const WORKFLOW_STATUSES = ['draft', 'published', 'retired'] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const DRAFT_WORKFLOW_STATUS: WorkflowStatus = 'draft';
export const PUBLISHED_WORKFLOW_STATUS: WorkflowStatus = 'published';
export const RETIRED_WORKFLOW_STATUS: WorkflowStatus = 'retired';
