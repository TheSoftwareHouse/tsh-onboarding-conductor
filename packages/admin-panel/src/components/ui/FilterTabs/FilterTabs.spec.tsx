import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { FilterTab, FilterTabs } from './FilterTabs';

function renderTabs(): void {
  render(
    <MemoryRouter>
      <FilterTabs label="Status">
        <FilterTab to="/onboardings" active count={128}>
          All
        </FilterTab>
        <FilterTab to="/onboardings?status=progress" active={false}>
          In progress
        </FilterTab>
      </FilterTabs>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('FilterTabs', () => {
  it('names the landmark', () => {
    renderTabs();

    expect(screen.getByRole('navigation', { name: 'Status' })).toBeInTheDocument();
  });

  it('marks the active tab, and only that one', () => {
    renderTabs();

    expect(screen.getByRole('link', { name: 'All 128' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'In progress' })).not.toHaveAttribute('aria-current');
  });

  it('renders no number for a tab given no count', () => {
    renderTabs();

    const tab = screen.getByRole('link', { name: 'In progress' });
    expect(tab).toHaveTextContent(/^In progress$/);
  });
});
