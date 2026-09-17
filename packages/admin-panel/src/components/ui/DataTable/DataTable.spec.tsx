import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table, TableEmptyRow, TableSurface, Th } from './DataTable';

afterEach(() => {
  cleanup();
});

describe('TableSurface', () => {
  it('names the scroll region for assistive tech', () => {
    render(
      <TableSurface label="Onboardings table">
        <p>content</p>
      </TableSurface>,
    );

    expect(screen.getByRole('region', { name: 'Onboardings table' })).toBeInTheDocument();
  });

  it('honours hidden, removing the region from the accessibility tree', () => {
    render(
      <TableSurface label="Onboardings table" hidden>
        <p>content</p>
      </TableSurface>,
    );

    expect(screen.queryByRole('region', { name: 'Onboardings table' })).not.toBeInTheDocument();
  });
});

describe('Table', () => {
  it('takes its accessible name from the caption', () => {
    render(
      <Table caption="Onboardings matching the current filters">
        <thead>
          <tr>
            <Th>Onboarding</Th>
          </tr>
        </thead>
      </Table>,
    );

    expect(
      screen.getByRole('table', { name: 'Onboardings matching the current filters' }),
    ).toBeInTheDocument();
  });
});

describe('Th', () => {
  it('renders a columnheader', () => {
    render(
      <table>
        <thead>
          <tr>
            <Th>Status</Th>
          </tr>
        </thead>
      </table>,
    );

    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('right-aligns when align is end', () => {
    render(
      <table>
        <thead>
          <tr>
            <Th align="end">Actions</Th>
          </tr>
        </thead>
      </table>,
    );

    expect(screen.getByRole('columnheader', { name: 'Actions' })).toHaveClass('text-right');
  });
});

describe('TableEmptyRow', () => {
  it('spans the given colSpan', () => {
    render(
      <table>
        <tbody>
          <TableEmptyRow colSpan={5}>No onboardings match the current filters.</TableEmptyRow>
        </tbody>
      </table>,
    );

    const cell = screen.getByRole('cell', {
      name: 'No onboardings match the current filters.',
    });

    expect(cell).toHaveAttribute('colspan', '5');
  });
});
