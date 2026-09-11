import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableResults } from './TableResults';
import type { PaginationWindow } from '../../lib/pagination';

function pagination(overrides: Partial<PaginationWindow> = {}): PaginationWindow {
  return { page: 1, limit: 20, total: 41, totalPages: 3, ...overrides };
}

afterEach(() => {
  cleanup();
});

describe('TableResults', () => {
  it('announces the status message inside the named region', () => {
    render(
      <TableResults
        statusMessage="Showing 20 of 41 onboardings"
        regionLabel="Onboardings results"
        paginationLabel="Onboarding pages"
        showTable
        pagination={pagination()}
        paginationDisabled={false}
        onPageChange={vi.fn()}
      >
        <table />
      </TableResults>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Showing 20 of 41 onboardings');
    expect(screen.getByRole('region', { name: 'Onboardings results' })).toBeInTheDocument();
  });

  it('renders the pager when a page window is available', () => {
    render(
      <TableResults
        statusMessage="Showing 20 of 41 onboardings"
        regionLabel="Onboardings results"
        paginationLabel="Onboarding pages"
        showTable
        pagination={pagination()}
        paginationDisabled={false}
        onPageChange={vi.fn()}
      >
        <table />
      </TableResults>,
    );

    expect(screen.getByRole('navigation', { name: 'Onboarding pages' })).toBeInTheDocument();
  });

  it('hides the pager when there is no page window', () => {
    render(
      <TableResults
        statusMessage="Loading…"
        regionLabel="Onboardings results"
        paginationLabel="Onboarding pages"
        showTable={false}
        pagination={null}
        paginationDisabled
        onPageChange={vi.fn()}
      >
        <table />
      </TableResults>,
    );

    expect(screen.queryByRole('navigation', { name: 'Onboarding pages' })).not.toBeInTheDocument();
  });

  it('hides the pager when the endpoint reports no pages', () => {
    render(
      <TableResults
        statusMessage="No results"
        regionLabel="Onboardings results"
        paginationLabel="Onboarding pages"
        showTable
        pagination={pagination({ totalPages: 0 })}
        paginationDisabled={false}
        onPageChange={vi.fn()}
      >
        <table />
      </TableResults>,
    );

    expect(screen.queryByRole('navigation', { name: 'Onboarding pages' })).not.toBeInTheDocument();
  });
});
