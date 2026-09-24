import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { AuditFilters, type AuditFiltersProps } from './AuditFilters';
import type { AuditEventFilters } from '../../utils/filter-audit-events';

afterEach(() => {
  cleanup();
});

const EMPTY_FILTERS: AuditEventFilters = {
  actorType: '',
  actorId: '',
  action: '',
  resourceType: '',
  resourceId: '',
  occurredPeriod: '',
  occurredFrom: '',
  occurredTo: '',
  limit: DEFAULT_PAGE_SIZE,
};

function renderFilters(overrides: Partial<AuditFiltersProps> = {}): void {
  render(
    <AuditFilters
      filters={EMPTY_FILTERS}
      appliedCount={0}
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

    expect(screen.getByLabelText('Resource ID')).toBeInTheDocument();
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

  it('does not render Resource type, which has no grid cell', () => {
    renderFilters();

    expect(screen.queryByLabelText('Resource type')).not.toBeInTheDocument();
  });

  it('counts a resourceType carried in the committed filters even without a cell for it', () => {
    renderFilters({ appliedCount: 1 });
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  // A criterion typed into the grid narrows nothing until Apply puts it in the URL, so the chip
  // and the shareable-link note stay off while it is still only a draft.
  it('counts only the committed criteria, never the ones still drafted in the grid', () => {
    renderFilters({ filters: { ...EMPTY_FILTERS, actorId: 'admin-1' } });

    expect(screen.queryByText(/active/)).not.toBeInTheDocument();
    expect(screen.queryByText('Saved as a shareable link')).not.toBeInTheDocument();
  });
});
