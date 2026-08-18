import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import { AUDIT_ACTOR_TYPES, describeAuditActorType } from '../types/audit-event';
import {
  AUDIT_FILTER_MAX_LENGTHS,
  AUDIT_PAGE_SIZES,
  type AuditEventFilters as AuditFiltersValue,
  type AuditPageSize,
} from '../utils/filter-audit-events';

export interface AuditFiltersProps {
  filters: AuditFiltersValue;
  disabled: boolean;
  /** Message describing why the requested time window was refused, or null when it is valid. */
  occurredError: string | null;
  onFilterChange: <K extends keyof AuditFiltersValue>(key: K, value: AuditFiltersValue[K]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Renders the labelled filter form: every criterion the audit endpoint accepts, plus actions. */
export function AuditFilters({
  filters,
  disabled,
  occurredError,
  onFilterChange,
  onSubmit,
  onReset,
  onReload,
}: AuditFiltersProps): ReactElement {
  const occurredInvalid = occurredError !== null;

  return (
    <form
      className="filters"
      aria-label="Filter audit events"
      onSubmit={onSubmit}
      onReset={onReset}
    >
      <div className="field">
        <label htmlFor="actor-type-filter">Actor type</label>
        <select
          id="actor-type-filter"
          name="actorType"
          disabled={disabled}
          value={filters.actorType}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            onFilterChange('actorType', event.target.value as AuditFiltersValue['actorType'])
          }
        >
          <option value="">All</option>
          {AUDIT_ACTOR_TYPES.map((actorType) => (
            <option key={actorType} value={actorType}>
              {describeAuditActorType(actorType)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="actor-id-filter">Actor ID</label>
        <input
          id="actor-id-filter"
          name="actorId"
          type="text"
          autoComplete="off"
          maxLength={AUDIT_FILTER_MAX_LENGTHS.actorId}
          disabled={disabled}
          value={filters.actorId}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('actorId', event.target.value)
          }
        />
      </div>
      <div className="field">
        <label htmlFor="action-filter">Action</label>
        <input
          id="action-filter"
          name="action"
          type="text"
          autoComplete="off"
          maxLength={AUDIT_FILTER_MAX_LENGTHS.action}
          disabled={disabled}
          value={filters.action}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('action', event.target.value)
          }
        />
      </div>
      <div className="field">
        <label htmlFor="resource-type-filter">Resource type</label>
        <input
          id="resource-type-filter"
          name="resourceType"
          type="text"
          autoComplete="off"
          maxLength={AUDIT_FILTER_MAX_LENGTHS.resourceType}
          disabled={disabled}
          value={filters.resourceType}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('resourceType', event.target.value)
          }
        />
      </div>
      <div className="field">
        <label htmlFor="resource-id-filter">Resource ID</label>
        <input
          id="resource-id-filter"
          name="resourceId"
          type="text"
          autoComplete="off"
          maxLength={AUDIT_FILTER_MAX_LENGTHS.resourceId}
          disabled={disabled}
          value={filters.resourceId}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('resourceId', event.target.value)
          }
        />
      </div>
      <div className="field">
        <label htmlFor="occurred-from-filter">Occurred from</label>
        <input
          id="occurred-from-filter"
          name="occurredFrom"
          type="datetime-local"
          aria-describedby="occurred-error"
          aria-invalid={occurredInvalid}
          disabled={disabled}
          value={filters.occurredFrom}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('occurredFrom', event.target.value)
          }
        />
      </div>
      <div className="field">
        <label htmlFor="occurred-to-filter">Occurred to</label>
        <input
          id="occurred-to-filter"
          name="occurredTo"
          type="datetime-local"
          aria-describedby="occurred-error"
          aria-invalid={occurredInvalid}
          disabled={disabled}
          value={filters.occurredTo}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('occurredTo', event.target.value)
          }
        />
        <p id="occurred-error" className="field-error" hidden={!occurredInvalid}>
          {occurredError}
        </p>
      </div>
      <div className="field">
        <label htmlFor="page-size-filter">Per page</label>
        <select
          id="page-size-filter"
          name="limit"
          disabled={disabled}
          value={filters.limit}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            onFilterChange('limit', Number(event.target.value) as AuditPageSize)
          }
        >
          {AUDIT_PAGE_SIZES.map((pageSize) => (
            <option key={pageSize} value={pageSize}>
              {pageSize}
            </option>
          ))}
        </select>
      </div>
      <div className="actions">
        <button type="submit" disabled={disabled}>
          Apply filters
        </button>
        <button type="button" disabled={disabled} onClick={onReload}>
          Reload
        </button>
        <button type="reset" disabled={disabled}>
          Reset filters
        </button>
      </div>
    </form>
  );
}
