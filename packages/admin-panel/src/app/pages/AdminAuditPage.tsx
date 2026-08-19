import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
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
  const [filters, setFilters] = useState<AuditEventFilters>(createDefaultAuditEventFilters);
  const [occurredError, setOccurredError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const normalized = normalizeAuditEventFilters(filters);
    if (!normalized.ok) {
      setOccurredError(normalized.error.message);
      return;
    }

    setOccurredError(null);
    applyFilters(filters);
  };

  const handleReset = (): void => {
    setFilters(createDefaultAuditEventFilters());
    setOccurredError(null);
    resetFilters();
  };

  const updateFilter = <K extends keyof AuditEventFilters>(
    key: K,
    value: AuditEventFilters[K],
  ): void => {
    setOccurredError(null);
    setFilters((current) => ({ ...current, [key]: value }));
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
