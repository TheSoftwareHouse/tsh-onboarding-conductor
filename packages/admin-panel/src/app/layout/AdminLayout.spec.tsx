import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { ADMIN_SECTIONS } from '../navigation';

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
  it('offers a link for every registered section, so a new page needs no layout change', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    const sidebar = screen.getByRole('navigation', { name: 'Sections' });

    for (const section of ADMIN_SECTIONS) {
      expect(within(sidebar).getByRole('link', { name: section.label })).toHaveAttribute(
        'href',
        section.path,
      );
    }
  });

  it('marks the item matching the current path so operators can see where they are', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    expect(screen.getByRole('link', { name: ADMIN_SECTIONS[0].label })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('returns a sidebar item to the filters its section was last seen with', async () => {
    renderLayout('/onboardings?status=approved');

    // Leaving the onboardings section for another one must not cost the operator their criteria.
    await userEvent.click(screen.getByRole('link', { name: 'Audit log' }));

    expect(screen.getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings?status=approved',
    );
  });

  it('titles the page after the matched section and renders it inside the shared chrome', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    expect(
      screen.getByRole('heading', { level: 1, name: ADMIN_SECTIONS[0].label }),
    ).toBeInTheDocument();
    expect(screen.getByText(`${ADMIN_SECTIONS[0].label} content`)).toBeInTheDocument();
  });
});
