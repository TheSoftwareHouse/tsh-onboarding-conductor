import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  getAdminOnboardings,
  type AdminOnboardingSummary,
  type AdminOnboardingsFilters,
} from '../api/admin-onboardings-client';

type FilterFormValues = {
  status: string;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
};

const emptyFormValues: FilterFormValues = {
  status: '',
  workflowId: '',
  workflowVersion: '',
  currentStep: '',
  onboardingId: '',
};

type RequestState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; rows: AdminOnboardingSummary[] };

function toFilters(values: FilterFormValues): AdminOnboardingsFilters {
  const filters: AdminOnboardingsFilters = {};

  if (values.status.trim()) {
    filters.status = values.status.trim();
  }

  if (values.workflowId.trim()) {
    filters.workflowId = values.workflowId.trim();
  }

  if (values.workflowVersion.trim()) {
    const parsedVersion = Number(values.workflowVersion.trim());

    if (Number.isFinite(parsedVersion)) {
      filters.workflowVersion = parsedVersion;
    }
  }

  if (values.currentStep.trim()) {
    filters.currentStep = values.currentStep.trim();
  }

  if (values.onboardingId.trim()) {
    filters.onboardingId = values.onboardingId.trim();
  }

  return filters;
}

function formatNullable(value: string | null): string {
  return value === null || value.trim() === '' ? '—' : value;
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return '—';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function AdminOnboardingsPanel() {
  const [formValues, setFormValues] = useState<FilterFormValues>(emptyFormValues);
  const [appliedFilters, setAppliedFilters] = useState<AdminOnboardingsFilters>({});
  const [requestState, setRequestState] = useState<RequestState>({ status: 'loading' });
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;

    setRequestState({ status: 'loading' });

    getAdminOnboardings(appliedFilters)
      .then((rows) => {
        if (!cancelled) {
          setRequestState({ status: 'success', rows });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRequestState({ status: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appliedFilters]);

  const handleFieldChange =
    (field: keyof FilterFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { value } = event.target;
      setFormValues((previous) => ({ ...previous, [field]: value }));
    };

  const handleApply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(toFilters(formValues));
  };

  const handleClear = () => {
    setFormValues(emptyFormValues);
    setAppliedFilters({});
  };

  const handleRetry = () => {
    setAppliedFilters((previous) => ({ ...previous }));
  };

  return (
    <section aria-labelledby={headingId} className="admin-onboardings-panel">
      <h2 id={headingId}>Admin onboarding list</h2>

      <form className="admin-onboardings-filters" onSubmit={handleApply}>
        <div className="admin-onboardings-field">
          <label htmlFor="filter-status">Status</label>
          <select
            id="filter-status"
            value={formValues.status}
            onChange={handleFieldChange('status')}
          >
            <option value="">Any</option>
            <option value="awaiting_user">Awaiting user</option>
            <option value="approved">Approved</option>
          </select>
        </div>

        <div className="admin-onboardings-field">
          <label htmlFor="filter-workflow-id">Workflow ID</label>
          <input
            id="filter-workflow-id"
            type="text"
            value={formValues.workflowId}
            onChange={handleFieldChange('workflowId')}
          />
        </div>

        <div className="admin-onboardings-field">
          <label htmlFor="filter-workflow-version">Workflow version</label>
          <input
            id="filter-workflow-version"
            type="number"
            min={1}
            step={1}
            value={formValues.workflowVersion}
            onChange={handleFieldChange('workflowVersion')}
          />
        </div>

        <div className="admin-onboardings-field">
          <label htmlFor="filter-current-step">Current step</label>
          <input
            id="filter-current-step"
            type="text"
            value={formValues.currentStep}
            onChange={handleFieldChange('currentStep')}
          />
        </div>

        <div className="admin-onboardings-field">
          <label htmlFor="filter-onboarding-id">Onboarding ID</label>
          <input
            id="filter-onboarding-id"
            type="text"
            value={formValues.onboardingId}
            onChange={handleFieldChange('onboardingId')}
          />
        </div>

        <div className="admin-onboardings-actions">
          <button type="submit">Apply</button>
          <button type="button" onClick={handleClear}>
            Clear
          </button>
        </div>
      </form>

      <div aria-live="polite" className="admin-onboardings-status">
        {requestState.status === 'loading' ? <p>Loading admin onboardings…</p> : null}
        {requestState.status === 'error' ? (
          <p role="alert">
            Unable to load admin onboardings.{' '}
            <button type="button" onClick={handleRetry}>
              Retry
            </button>
          </p>
        ) : null}
        {requestState.status === 'success' && requestState.rows.length === 0 ? (
          <p>No admin onboardings match the current filters.</p>
        ) : null}
      </div>

      {requestState.status === 'success' && requestState.rows.length > 0 ? (
        <div className="admin-onboardings-table-wrapper">
          <table>
            <caption>Admin onboardings</caption>
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
              {requestState.rows.map((row) => (
                <tr key={row.onboardingId}>
                  <td>{row.onboardingId}</td>
                  <td>{row.workflowId}</td>
                  <td>{row.workflowVersion}</td>
                  <td>{row.status}</td>
                  <td>{formatNullable(row.currentStep)}</td>
                  <td>{formatTimestamp(row.expiresAt)}</td>
                  <td>{formatTimestamp(row.createdAt)}</td>
                  <td>{formatTimestamp(row.updatedAt)}</td>
                  <td>{formatTimestamp(row.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
