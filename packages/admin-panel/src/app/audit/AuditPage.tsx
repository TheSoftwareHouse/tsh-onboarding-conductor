import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { AdminPageProps } from '@/lib/admin-page';
import type { DateTimeRange } from '@/components/ui/filters/DateTimeRangeField/DateTimeRangeField';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import type { AuditEvent } from '@/api/audit/audit-events';
import type { ApiError } from '@/services/api/api-error';
import { AuditFilters } from './components/AuditFilters/AuditFilters';
import { AuditResourceTabs } from './components/AuditResourceTabs/AuditResourceTabs';
import { AuditResults } from './components/AuditResults/AuditResults';
import { useAuditEvents } from './hooks/useAuditEvents';
import {
  countActiveAuditFilters,
  DEFAULT_AUDIT_EVENT_FILTERS,
  findOccurredWindowError,
  type AuditEventFilters,
} from './utils/filter-audit-events';

function describeFetchError(error: ApiError): string {
  return `Unable to load audit events: ${error.message}`;
}

/** Composes the Logs section: its header, resource-type tabs, filter band, results table, and pager. */
export function AuditPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const {
    phase,
    events,
    pagination,
    error,
    appliedFilters,
    appliedSearchValues,
    applyFilters,
    goToPage,
    refetch,
    resetFilters,
  } = useAuditEvents();
  // Seeded from the committed filters so a URL carrying criteria - a shared link, or the section
  // returned to - shows them in the controls instead of blank ones. The draft is the operator's
  // from then on.
  const [filters, setFilters] = useState<AuditEventFilters>(appliedFilters);

  // resourceType commits immediately - a tab is a `<Link>` that changes the URL without
  // remounting this page - so reading it from the draft would mean acting on whatever it
  // happened to be when the draft was last seeded. resourceId no longer needs this: it is now
  // typed straight into the draft, and that drafted value is the authoritative one until Apply.
  const effectiveFilters: AuditEventFilters = {
    ...filters,
    resourceType: appliedFilters.resourceType,
  };

  // Derived rather than held, so a refused window is reported the moment a bound changes instead
  // of only once Apply has been pressed - and stops being reported the moment it is corrected.
  const occurredError = findOccurredWindowError(effectiveFilters);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (occurredError !== null) {
      return;
    }

    applyFilters(effectiveFilters);
  };

  const handleReset = (): void => {
    setFilters(DEFAULT_AUDIT_EVENT_FILTERS);
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
  const appliedCount = countActiveAuditFilters(appliedSearchValues);
  const appliedFilterActive = appliedCount > 0;

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
      <PageHeader eyebrow={eyebrow} title={title} />
      <AuditResourceTabs filters={appliedFilters} total={pagination?.total ?? 0} />
      <AuditFilters
        filters={effectiveFilters}
        appliedCount={appliedCount}
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
