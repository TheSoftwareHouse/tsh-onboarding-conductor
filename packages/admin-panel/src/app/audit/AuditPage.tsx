import type { FormEvent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import type { AdminPageProps } from '@/lib/admin-page';
import type { DateTimeRange } from '@/components/ui/filters/DateTimeRangeField/DateTimeRangeField';
import { Button } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import type { AuditEvent } from '@/api/audit/audit-events';
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
  const appliedCount = countActiveAuditFilters(appliedSearchValues);
  const appliedFilterActive = appliedCount > 0;

  let state: ReactNode;
  let statusMessage: string | null = null;
  let visibleEvents: AuditEvent[] = [];

  if (phase === 'loading') {
    state = <Loader label="Loading audit events…" />;
  } else if (phase === 'error') {
    state = (
      <LoadFailure
        error={error}
        subject="audit events"
        deniedSubject="the audit log"
        onRetry={handleReload}
      />
    );
  } else if (occurredError !== null) {
    state = (
      <EmptyState
        kind="noMatch"
        title="Correct the refused filter to see results"
        body={occurredError}
      />
    );
  } else if (events.length === 0 || pagination === null) {
    state = appliedFilterActive ? (
      <EmptyState
        kind="noMatch"
        title="No audit events match the current filters"
        body="Change or reset the filters to see more."
        actions={
          <Button variant="primary" size="lg" onClick={handleReset}>
            Reset filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="No audit events yet"
        body="Events are recorded as onboardings, connectors and workflows change."
      />
    );
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
        state={state}
        visibleEvents={visibleEvents}
        pagination={pagination}
        paginationDisabled={disabled}
        onPageChange={goToPage}
      />
    </div>
  );
}
