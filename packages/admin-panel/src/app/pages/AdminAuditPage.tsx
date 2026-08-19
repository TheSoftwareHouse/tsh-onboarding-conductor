import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { DateTimeRange } from '@/shared/components/filters';
import {
  type AuditEvent,
  type AuditEventFilters,
  type AuditEventsFetchError,
  AuditFilters,
  AuditResults,
  createDefaultAuditEventFilters,
  normalizeAuditEventFilters,
  useAuditEvents,
} from '@/features/audit';
import { hasActiveFilters } from '@/shared/lib/count-active-filters';

function describeFetchError(error: AuditEventsFetchError): string {
  return `Unable to load audit events: ${error.message}`;
}

/** Composes the audit log section: filters, live status region, results table, and pager. */
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

  // Derived rather than held, so a refused window is reported the moment a bound changes instead
  // of only once Apply has been pressed - and stops being reported the moment it is corrected.
  const draft = normalizeAuditEventFilters(filters);
  const occurredError = draft.ok ? null : draft.error.message;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (!draft.ok) {
      return;
    }

    applyFilters(filters);
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
    setFilters((current) => ({ ...current, occurredFrom: range.from, occurredTo: range.to }));
  };

  const handleReload = (): void => {
    refetch();
  };

  const disabled = phase === 'loading';
  const showTable = phase === 'ready';
  const appliedFilterActive = hasActiveFilters(appliedFilters, ['limit']);

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
    <>
      <AuditFilters
        filters={filters}
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
    </>
  );
}
