import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { AuditFilters, type AuditFiltersProps } from './AuditFilters';
import type { AuditEventFilters } from '../utils/filter-audit-events';

afterEach(() => {
  cleanup();
});

const EMPTY_FILTERS: AuditEventFilters = {
  actorType: '',
  actorId: '',
  action: '',
  resourceType: '',
  resourceId: '',
  occurredFrom: '',
  occurredTo: '',
  limit: DEFAULT_PAGE_SIZE,
};

function renderFilters(overrides: Partial<AuditFiltersProps> = {}): void {
  render(
    <AuditFilters
      filters={EMPTY_FILTERS}
      disabled={false}
      occurredError={null}
      onFilterChange={vi.fn()}
      onOccurredRangeChange={vi.fn()}
      onSubmit={vi.fn()}
      onReset={vi.fn()}
      onReload={vi.fn()}
      {...overrides}
    />,
  );
}

describe('AuditFilters', () => {
  it('reaches every criterion the design draws by its label', () => {
    renderFilters();

    expect(screen.getByLabelText('Actor')).toBeInTheDocument();
    expect(screen.getByLabelText('Actor ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Action')).toBeInTheDocument();
    expect(screen.getByLabelText('Occurred')).toBeInTheDocument();
    expect(screen.getByLabelText('Per page')).toBeInTheDocument();
  });

  it('offers "All actors" as the Actor criterion\'s cleared value', () => {
    renderFilters();

    expect(screen.getByRole('option', { name: 'All actors' })).toBeInTheDocument();
  });

  it('does not render Resource type or Resource ID, which moved off the grid', () => {
    renderFilters();

    expect(screen.queryByLabelText('Resource type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Resource ID')).not.toBeInTheDocument();
  });

  it('counts a resourceType or resourceId carried in the filters even without a cell for them', () => {
    renderFilters({ filters: { ...EMPTY_FILTERS, resourceType: 'onboarding' } });
    expect(screen.getByText('1 active')).toBeInTheDocument();

    cleanup();
    renderFilters({ filters: { ...EMPTY_FILTERS, resourceId: 'abc-123' } });
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });
});
