import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
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
          <Route path={`${ADMIN_SECTIONS[0].path}/:id`} element={<p>Detail content</p>} />
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
    await userEvent.click(screen.getByRole('link', { name: 'Logs' }));

    expect(screen.getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings?status=approved',
    );
  });

  it('renders the matched page inside the shared chrome, heading none of it itself', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    // Every page heads itself, so the actions it steers sit in the band that names it.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText(`${ADMIN_SECTIONS[0].label} content`)).toBeInTheDocument();
  });

  it('leaves the outlet unpadded, so a page can draw edge-to-edge bands', () => {
    renderLayout(ADMIN_SECTIONS[0].path);

    const outletWrapper = screen.getByText(`${ADMIN_SECTIONS[0].label} content`).parentElement;

    expect(outletWrapper).not.toHaveClass('p-8');
  });

  it('renders a detail page in the same chrome as the section it was reached from', () => {
    renderLayout(`${ADMIN_SECTIONS[0].path}/some-id`);

    expect(screen.getByRole('link', { name: ADMIN_SECTIONS[0].label })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Detail content')).toBeInTheDocument();
  });

  it("keeps a nested page's own params out of the remembered section search", async () => {
    render(
      <MemoryRouter initialEntries={['/onboardings?status=approved']}>
        <Routes>
          <Route element={<AdminLayout />}>
            <Route
              path={ADMIN_SECTIONS[0].path}
              element={<Link to="/onboardings/some-id?status=approved&tab=scores">Detail</Link>}
            />
            {ADMIN_SECTIONS.slice(1).map((section) => (
              <Route
                key={section.path}
                path={section.path}
                element={<p>{section.label} content</p>}
              />
            ))}
            <Route path={`${ADMIN_SECTIONS[0].path}/:id`} element={<p>Detail content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // Reaching the details page carries the list's filters plus its own `tab`, which must not leak.
    await userEvent.click(screen.getByRole('link', { name: 'Detail' }));

    expect(screen.getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings?status=approved',
    );
  });
});
