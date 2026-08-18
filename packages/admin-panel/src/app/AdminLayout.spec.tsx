import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { ADMIN_SECTIONS } from './navigation';

function renderLayout(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AdminLayout />}>
          {ADMIN_SECTIONS.map((section) => (
            <Route
              key={section.path}
              path={section.path}
              element={<p>{section.label} content</p>}
            />
          ))}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('AdminLayout', () => {
  it('offers a tab for every registered section, so a new page needs no layout change', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    const tabs = screen.getByRole('navigation', { name: 'Sections' });

    for (const section of ADMIN_SECTIONS) {
      expect(within(tabs).getByRole('link', { name: section.label })).toHaveAttribute(
        'href',
        section.path,
      );
    }
  });

  it('marks the tab matching the current path so operators can see where they are', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    expect(screen.getByRole('link', { name: ADMIN_SECTIONS[0].label })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the matched section inside the shared chrome', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    expect(screen.getByRole('heading', { name: 'Admin panel' })).toBeInTheDocument();
    expect(screen.getByText(`${ADMIN_SECTIONS[0].label} content`)).toBeInTheDocument();
  });
});
