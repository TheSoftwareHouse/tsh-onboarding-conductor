import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AssignmentTurnedIn, Cable } from '../icons';
import { SideNav, SideNavGroup, SideNavItem } from './SideNav';

function renderNav(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SideNav label="Sections">
        <SideNavGroup label="Monitor">
          <SideNavItem to="/onboardings" icon={AssignmentTurnedIn}>
            Onboardings
          </SideNavItem>
        </SideNavGroup>
        <SideNavGroup label="Build">
          <SideNavItem to="/connectors" icon={Cable}>
            Connectors
          </SideNavItem>
        </SideNavGroup>
      </SideNav>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('SideNav', () => {
  it('names the landmark and keeps each item under its group', () => {
    renderNav('/onboardings');

    const nav = screen.getByRole('navigation', { name: 'Sections' });

    expect(within(nav).getByText('Monitor')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'href',
      '/onboardings',
    );
  });

  it('marks the item being viewed, and only that one', () => {
    renderNav('/onboardings');

    expect(screen.getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Connectors' })).not.toHaveAttribute('aria-current');
  });

  it('keeps a section marked from a page reached within it, such as an onboarding detail', () => {
    renderNav('/onboardings/018f1e2a-4444-7000-8000-000000000001');

    expect(screen.getByRole('link', { name: 'Onboardings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
