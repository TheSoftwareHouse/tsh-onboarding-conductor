import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAdminOnboardings, type AdminOnboardingsFetchError } from './api/admin-onboardings';
import { filterAdminOnboardings, type AdminOnboardingFilters } from './filter-admin-onboardings';
import type { AdminOnboardingSummary } from './types/admin-onboarding';

const NOT_SET = '-';
const INVALID_DATE = 'Invalid date';
const WORKFLOW_VERSION_ERROR_MESSAGE = 'Enter a whole number greater than zero.';
const TABLE_COLUMN_COUNT = 9;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type Phase = 'loading' | 'error' | 'ready';

function createDefaultFilters(): AdminOnboardingFilters {
  return {
    status: '',
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? INVALID_DATE : DATE_TIME_FORMATTER.format(date);
}

function formatNullableDateTime(value: string | null): string {
  return value === null ? NOT_SET : formatDateTime(value);
}

function formatNullableText(value: string | null): string {
  return value === null ? NOT_SET : value;
}

function describeFetchError(error: AdminOnboardingsFetchError): string {
  return `Unable to load onboardings: ${error.message}`;
}

/** Renders the admin onboardings page: filters, live status region, and results table. */
export function App(): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [records, setRecords] = useState<AdminOnboardingSummary[]>([]);
  const [error, setError] = useState<AdminOnboardingsFetchError | null>(null);
  const [filters, setFilters] = useState<AdminOnboardingFilters>(createDefaultFilters);
  const requestInFlightRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (requestInFlightRef.current) {
      // A request is already in flight (e.g. React StrictMode's development-only
      // double effect invocation). Reuse it instead of firing a duplicate request.
      return;
    }

    requestInFlightRef.current = true;
    setPhase('loading');

    try {
      const result = await fetchAdminOnboardings();

      if (result.ok) {
        setRecords(result.data);
        setError(null);
        setPhase('ready');
      } else {
        setError(result.error);
        setPhase('error');
      }
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (phase === 'loading') {
      return;
    }
    void load();
  };

  const handleReset = (): void => {
    setFilters(createDefaultFilters());
  };

  const updateFilter = <K extends keyof AdminOnboardingFilters>(
    key: K,
    value: AdminOnboardingFilters[K],
  ): void => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const disabled = phase === 'loading';
  const filterResult = filterAdminOnboardings(records, filters);
  const showTable = phase === 'ready';
  const workflowVersionInvalid = showTable && filterResult.workflowVersionInvalid;

  let statusMessage: string;
  let visibleRecords: AdminOnboardingSummary[] = [];
  let emptyMessage = '';

  if (phase === 'loading') {
    statusMessage = 'Loading onboardings\u2026';
  } else if (phase === 'error') {
    statusMessage = error ? describeFetchError(error) : 'Unable to load onboardings.';
  } else if (filterResult.workflowVersionInvalid) {
    statusMessage = WORKFLOW_VERSION_ERROR_MESSAGE;
    emptyMessage = 'Enter a valid workflow version to see results.';
  } else if (records.length === 0) {
    statusMessage = 'No onboardings were returned.';
    emptyMessage = 'No onboardings were returned.';
  } else if (filterResult.records.length === 0) {
    statusMessage = 'No onboardings match the current filters.';
    emptyMessage = 'No onboardings match the current filters.';
  } else {
    statusMessage = `Showing ${filterResult.records.length} of ${records.length} onboardings.`;
    visibleRecords = filterResult.records;
  }

  return (
    <div className="page">
      <h1>Admin onboardings</h1>
      <form
        className="filters"
        aria-label="Filter onboardings"
        onSubmit={handleSubmit}
        onReset={handleReset}
      >
        <div className="field">
          <label htmlFor="status-filter">Status</label>
          <select
            id="status-filter"
            name="status"
            disabled={disabled}
            value={filters.status}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              updateFilter('status', event.target.value as AdminOnboardingFilters['status'])
            }
          >
            <option value="">All</option>
            <option value="awaiting_user">Awaiting user</option>
            <option value="approved">Approved</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="workflow-id-filter">Workflow ID</label>
          <input
            id="workflow-id-filter"
            name="workflowId"
            type="text"
            autoComplete="off"
            disabled={disabled}
            value={filters.workflowId}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateFilter('workflowId', event.target.value)
            }
          />
        </div>
        <div className="field">
          <label htmlFor="workflow-version-filter">Workflow version</label>
          <input
            id="workflow-version-filter"
            name="workflowVersion"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-describedby="workflow-version-error"
            aria-invalid={workflowVersionInvalid}
            disabled={disabled}
            value={filters.workflowVersion}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateFilter('workflowVersion', event.target.value)
            }
          />
          <p id="workflow-version-error" className="field-error" hidden={!workflowVersionInvalid}>
            {WORKFLOW_VERSION_ERROR_MESSAGE}
          </p>
        </div>
        <div className="field">
          <label htmlFor="current-step-filter">Current step</label>
          <input
            id="current-step-filter"
            name="currentStep"
            type="text"
            autoComplete="off"
            disabled={disabled}
            value={filters.currentStep}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateFilter('currentStep', event.target.value)
            }
          />
        </div>
        <div className="field">
          <label htmlFor="onboarding-id-filter">Onboarding ID</label>
          <input
            id="onboarding-id-filter"
            name="onboardingId"
            type="text"
            autoComplete="off"
            disabled={disabled}
            value={filters.onboardingId}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateFilter('onboardingId', event.target.value)
            }
          />
        </div>
        <div className="actions">
          <button type="submit" disabled={disabled}>
            Reload
          </button>
          <button type="reset" disabled={disabled}>
            Reset filters
          </button>
        </div>
      </form>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      <div
        className="table-wrapper"
        tabIndex={0}
        role="region"
        aria-label="Onboardings results"
        hidden={!showTable}
      >
        <table>
          <caption className="visually-hidden">Onboardings matching the current filters</caption>
          <thead>
            <tr>
              <th scope="col">Onboarding ID</th>
              <th scope="col">Workflow ID</th>
              <th scope="col">Workflow version</th>
              <th scope="col">Status</th>
              <th scope="col">Current step</th>
              <th scope="col">Expires at</th>
              <th scope="col">Created at</th>
              <th scope="col">Updated at</th>
              <th scope="col">Completed at</th>
            </tr>
          </thead>
          <tbody>
            {showTable && visibleRecords.length === 0 && (
              <tr className="empty-row">
                <td colSpan={TABLE_COLUMN_COUNT}>{emptyMessage}</td>
              </tr>
            )}
            {showTable &&
              visibleRecords.map((record) => (
                <tr key={record.onboardingId}>
                  <td className="identifier">{record.onboardingId}</td>
                  <td className="identifier">{record.workflowId}</td>
                  <td className="identifier">{record.workflowVersion}</td>
                  <td className="identifier">{record.status}</td>
                  <td className="description">{formatNullableText(record.currentStep)}</td>
                  <td className="timestamp">{formatNullableDateTime(record.expiresAt)}</td>
                  <td className="timestamp">{formatDateTime(record.createdAt)}</td>
                  <td className="timestamp">{formatDateTime(record.updatedAt)}</td>
                  <td className="timestamp">{formatNullableDateTime(record.completedAt)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
