import type { FormEvent, ReactElement } from 'react';
import { FilterPanel } from '@/components/ui/filters/FilterPanel/FilterPanel';
import { TextFilterField } from '@/components/ui/filters/TextFilterField/TextFilterField';
import {
  SelectFilterField,
  toFilterOptions,
} from '@/components/ui/filters/SelectFilterField/SelectFilterField';
import { CheckboxFilterField } from '@/components/ui/filters/CheckboxFilterField/CheckboxFilterField';
import type { WorkflowScope } from '@/api/workflows/admin-workflows';
import {
  describeWorkflowScope,
  listSelectableWorkflowScopes,
  WORKFLOW_SEARCH_MAX_LENGTH,
  type AdminWorkflowFilters,
} from '../utils/filter-admin-workflows';

export interface WorkflowFiltersProps {
  filters: AdminWorkflowFilters;
  /** Count of the committed criteria - never the draft. See `FilterPanel`. */
  appliedCount: number;
  disabled: boolean;
  onFilterChange: <K extends keyof AdminWorkflowFilters>(
    key: K,
    value: AdminWorkflowFilters[K],
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Search, Scope and Has-unpublished-draft, rendered in the shared filter panel. */
export function WorkflowFilters({
  filters,
  appliedCount,
  disabled,
  onFilterChange,
  onSubmit,
  onReset,
  onReload,
}: WorkflowFiltersProps): ReactElement {
  return (
    <FilterPanel
      label="Filter workflows"
      appliedCount={appliedCount}
      disabled={disabled}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
    >
      <TextFilterField
        id="workflow-search-filter"
        name="search"
        label="Search"
        placeholder="Search by ID or name"
        maxLength={WORKFLOW_SEARCH_MAX_LENGTH}
        disabled={disabled}
        value={filters.search}
        onChange={(value: string) => onFilterChange('search', value)}
      />
      <SelectFilterField
        id="workflow-scope-filter"
        name="scope"
        label="Scope"
        anyOptionLabel="All"
        disabled={disabled}
        value={filters.scope}
        options={toFilterOptions(listSelectableWorkflowScopes(), describeWorkflowScope)}
        onChange={(value: string) => onFilterChange('scope', value as '' | WorkflowScope)}
      />
      <CheckboxFilterField
        id="workflow-has-draft-filter"
        name="hasDraft"
        label="Drafts"
        disabled={disabled}
        value={filters.hasDraft}
        onChange={(value: boolean) => onFilterChange('hasDraft', value)}
      >
        Has unpublished draft
      </CheckboxFilterField>
    </FilterPanel>
  );
}
