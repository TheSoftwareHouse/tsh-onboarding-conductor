import { createParser, type inferParserType } from 'nuqs';
import { parseAsPageNumber, parseAsTrimmedString, trimmedOrNull } from '@/lib/search-params';
import type { AdminWorkflowQueryFilters, WorkflowScope } from '@/api/workflows/admin-workflows';
import {
  listSelectableWorkflowScopes,
  WORKFLOWS_PAGE_SIZE,
  type AdminWorkflowFilters,
} from './filter-admin-workflows';

/** `false` also means "no filter" (see ADR 0032), so only the literal `true` parses to a value; anything else, including `false`, falls back to `null` per ADR 0018. */
const parseAsHasDraft = createParser<true>({
  parse: (value) => (value === 'true' ? true : null),
  serialize: () => 'true',
});

/** Checked at parse time, so a `?scope=fixtures` link opened on a production engine falls back to `null`. */
const parseAsWorkflowScope = createParser<WorkflowScope>({
  parse: (value) => listSelectableWorkflowScopes().find((scope) => scope === value) ?? null,
  serialize: (value) => value,
});

/** One nuqs parser per URL key; see ADR 0018 for the per-key fallback behaviour. */
export const adminWorkflowsSearchParams = {
  search: parseAsTrimmedString,
  scope: parseAsWorkflowScope,
  hasDraft: parseAsHasDraft,
  page: parseAsPageNumber,
};

/** State `useQueryStates(adminWorkflowsSearchParams, ...)` reads and writes. */
export type AdminWorkflowsSearchValues = inferParserType<typeof adminWorkflowsSearchParams>;

/** Filters as the URL states them, owning the `?? ''`/`?? false` the panel's controls need. */
export function toAdminWorkflowFilters(state: AdminWorkflowsSearchValues): AdminWorkflowFilters {
  return {
    search: state.search ?? '',
    scope: state.scope ?? '',
    hasDraft: state.hasDraft ?? false,
  };
}

/** Shared by the hook's commit path, so a committed URL is always built the same way. */
export function toAdminWorkflowsSearchValues(
  filters: AdminWorkflowFilters,
  page: number,
): AdminWorkflowsSearchValues {
  return {
    search: trimmedOrNull(filters.search),
    scope: filters.scope || null,
    // `false` also means "no filter" (see ADR 0032), so only `true` is ever committed.
    hasDraft: filters.hasDraft ? true : null,
    page,
  };
}

/** The committed set, ready for `workflowQueries.list`: the fixed page size, the rest as the URL states them. */
export function toAdminWorkflowQueryFilters(
  state: AdminWorkflowsSearchValues,
): AdminWorkflowQueryFilters {
  return {
    page: state.page,
    limit: WORKFLOWS_PAGE_SIZE,
    search: state.search,
    scope: state.scope,
    hasDraft: state.hasDraft,
  };
}
