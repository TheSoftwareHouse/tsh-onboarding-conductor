import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { DateTimeRange } from '@/shared/components/filters';
import {
  type AuditEvent,
  type AuditEventFilters,
  type AuditEventsFetchError,
  AuditFilters,
  AuditResourceTabs,
  AuditResults,
  AuditSearch,
  countActiveAuditFilters,
  createDefaultAuditEventFilters,
  normalizeAuditEventFilters,
  useAuditEvents,
} from '@/features/audit';
import { PageHeaderActions } from '@/shared/components/PageHeader/PageHeaderActions';

function describeFetchError(error: AuditEventsFetchError): string {
  return `Unable to load audit events: ${error.message}`;
}

/** Composes the Logs section: header search, resource-type tabs, filter band, results table, and pager. */
export function AdminAuditPage(): ReactElement {
  const {
    phase,
    events,
    pagination,
    error,
    appliedFilters,
    applyFilters,
    goToPage,
    refetch,
    resetFilters,
  } = useAuditEvents();
  // Seeded from the committed filters so a URL carrying criteria - a shared link, or the section
  // returned to - shows them in the controls instead of blank ones. The draft is the operator's
  // from then on.
  const [filters, setFilters] = useState<AuditEventFilters>(appliedFilters);

  // resourceType and resourceId commit immediately - a tab is a `<Link>`, the header search
  // commits on submit - so neither ever goes through this draft. Reading them from the draft
  // would mean acting on whatever they happened to be when the draft was last seeded, so every
  // read of them below uses the committed value instead.
  const effectiveFilters: AuditEventFilters = {
    ...filters,
    resourceType: appliedFilters.resourceType,
    resourceId: appliedFilters.resourceId,
  };

  // Derived rather than held, so a refused window is reported the moment a bound changes instead
  // of only once Apply has been pressed - and stops being reported the moment it is corrected.
  const draft = normalizeAuditEventFilters(effectiveFilters);
  const occurredError = draft.ok ? null : draft.error.message;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (!draft.ok) {
      return;
    }

    applyFilters(effectiveFilters);
  };

  const handleSearchSubmit = (resourceId: string): void => {
    // Built from the effective set, not the draft, for the same reason Apply is: the draft's
    // resourceType was seeded on mount and is stale the moment a tab is clicked, so committing it
    // here would discard the selected tab - or restore one the operator had just left.
    const nextFilters = { ...effectiveFilters, resourceId };
    setFilters(nextFilters);

    const normalized = normalizeAuditEventFilters(nextFilters);
    if (normalized.ok) {
      applyFilters(nextFilters);
    }
  };

  const handleReset = (): void => {
    setFilters(createDefaultAuditEventFilters());
    resetFilters();
  };

  const updateFilter = <K extends keyof AuditEventFilters>(
    key: K,
    value: AuditEventFilters[K],
  ): void => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const updateOccurredRange = (range: DateTimeRange): void => {
    setFilters((current) => ({
      ...current,
      occurredPeriod: range.period,
      occurredFrom: range.from,
      occurredTo: range.to,
    }));
  };

  const handleReload = (): void => {
    refetch();
  };

  const disabled = phase === 'loading';
  const showTable = phase === 'ready';
  const appliedFilterActive = countActiveAuditFilters(appliedFilters) > 0;

  let statusMessage: string;
  let visibleEvents: AuditEvent[] = [];
  let emptyMessage = '';

  if (phase === 'loading') {
    statusMessage = 'Loading audit events…';
  } else if (phase === 'error') {
    statusMessage = error ? describeFetchError(error) : 'Unable to load audit events.';
  } else if (occurredError !== null) {
    statusMessage = occurredError;
    visibleEvents = events;
  } else if (events.length === 0 || pagination === null) {
    statusMessage = appliedFilterActive
      ? 'No audit events match the current filters.'
      : 'No audit events were returned.';
    emptyMessage = statusMessage;
  } else {
    statusMessage = `Showing ${events.length} of ${pagination.total} audit events (page ${pagination.page} of ${pagination.totalPages}).`;
    visibleEvents = events;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeaderActions>
        {/* Keyed on the committed value so Reset filters (or a fresh submit) remounts the search
            box with the new seed instead of leaving a stale draft behind. */}
        <AuditSearch
          key={appliedFilters.resourceId}
          value={appliedFilters.resourceId}
          disabled={disabled}
          onSubmit={handleSearchSubmit}
        />
      </PageHeaderActions>
      <AuditResourceTabs filters={appliedFilters} total={pagination?.total ?? 0} />
      <AuditFilters
        filters={effectiveFilters}
        disabled={disabled}
        occurredError={occurredError}
        onFilterChange={updateFilter}
        onOccurredRangeChange={updateOccurredRange}
        onSubmit={handleSubmit}
        onReset={handleReset}
        onReload={handleReload}
      />
      <AuditResults
        statusMessage={statusMessage}
        showTable={showTable}
        visibleEvents={visibleEvents}
        emptyMessage={emptyMessage}
        pagination={pagination}
        paginationDisabled={disabled}
        onPageChange={goToPage}
      />
    </div>
  );
}
