import { findEnvironment } from '@/config/environment';
import { countActiveFilters } from '@/lib/count-active-filters';
import type { WorkflowScope } from '@/api/workflows/admin-workflows';
import type { AdminWorkflowsSearchValues } from './admin-workflows-search-params';

/** Rows requested per page; the design draws no page-size control, so this never varies. */
export const WORKFLOWS_PAGE_SIZE = 20;

/** Longest search the endpoint accepts, mirroring its `MaxLength(100)`. */
export const WORKFLOW_SEARCH_MAX_LENGTH = 100;

/** Raw, uncommitted filter control values as entered by the operator. */
export interface AdminWorkflowFilters {
  search: string;
  /** Empty string means "All" (the criterion is disabled). */
  scope: '' | WorkflowScope;
  hasDraft: boolean;
}

/** Draft filter control values reset to "no criteria applied". Frozen: every consumer shares it. */
export const DEFAULT_ADMIN_WORKFLOW_FILTERS: AdminWorkflowFilters = Object.freeze({
  search: '',
  scope: '',
  hasDraft: false,
});

/** How many criteria narrow the list, which is the number the filter band reports. */
export function countActiveAdminWorkflowFilters(state: AdminWorkflowsSearchValues): number {
  return countActiveFilters(state, ['page']);
}

/** Option label for a scope value: the engine's own literal, as the design's select draws it. */
export function describeWorkflowScope(scope: WorkflowScope): string {
  return scope;
}

/** The Scope select's own display order (built-in, users, fixtures) - the design's, not `WORKFLOW_SCOPES`' declaration order. */
const WORKFLOW_SCOPE_DISPLAY_ORDER: readonly WorkflowScope[] = ['built-in', 'users', 'fixtures'];

/** Scopes an operator can filter by: a production engine never loads `fixtures`, so it is not offered there. */
export function listSelectableWorkflowScopes(): readonly WorkflowScope[] {
  if (findEnvironment()?.isProduction) {
    return WORKFLOW_SCOPE_DISPLAY_ORDER.filter((scope) => scope !== 'fixtures');
  }
  return WORKFLOW_SCOPE_DISPLAY_ORDER;
}
