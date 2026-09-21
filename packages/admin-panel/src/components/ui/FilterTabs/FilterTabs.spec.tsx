import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { FilterTab, FilterTabGroup, FilterTabNote, FilterTabs } from './FilterTabs';

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

function renderVerticalTabs(): void {
  render(
    <MemoryRouter>
      <FilterTabs label="Connector type" orientation="vertical">
        <FilterTabGroup label="Connector type">
          <FilterTab to="/connectors?type=kyc" active count={2}>
            Identity verification
          </FilterTab>
          <FilterTab to="/connectors?type=phone_verification" active={false}>
            Phone verification
          </FilterTab>
        </FilterTabGroup>
        <FilterTabGroup label="Not implemented">
          <FilterTabNote>Business verification</FilterTabNote>
        </FilterTabGroup>
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

  it('renders the default horizontal classes and structure', () => {
    renderTabs();

    const nav = screen.getByRole('navigation', { name: 'Status' });
    expect(nav).toHaveClass('flex', 'items-end', 'border-b', 'border-border-rule', 'px-8');

    const activeTab = screen.getByRole('link', { name: 'All 128' });
    expect(activeTab).toHaveClass(
      'text-body-md',
      'no-underline',
      'mr-8',
      'border-b-2',
      'py-4',
      'last:mr-0',
      'border-tsh-black',
      'text-fg-1',
    );

    const inactiveTab = screen.getByRole('link', { name: 'In progress' });
    expect(inactiveTab).toHaveClass('border-transparent', 'text-fg-3');

    const activeCount = activeTab.querySelector('span');
    expect(activeCount).toHaveClass('font-mono', 'text-mono', 'text-fg-4');
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

  it('renders a zero count rather than treating it as omitted', () => {
    render(
      <MemoryRouter>
        <FilterTabs label="Status">
          <FilterTab to="/onboardings?status=archived" active count={0}>
            Archived
          </FilterTab>
        </FilterTabs>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Archived 0' })).toHaveTextContent('Archived 0');
  });

  it('renders the vertical nav classes', () => {
    renderVerticalTabs();

    const nav = screen.getByRole('navigation', { name: 'Connector type' });
    expect(nav).toHaveClass(
      'flex',
      'w-filter-nav',
      'flex-col',
      'gap-6',
      'overflow-y-auto',
      'border-r',
      'border-border-rule',
      'py-6',
    );

    const activeTab = screen.getByRole('link', { name: 'Identity verification 2' });
    expect(activeTab).toHaveClass(
      'text-body-md',
      'no-underline',
      'flex',
      'items-center',
      'gap-3',
      'border-l-3',
      'px-6',
      'py-3',
      'hover:bg-bg-subtle',
      'border-l-tsh-black',
      'bg-bg-alt',
      'text-fg-1',
    );

    const inactiveTab = screen.getByRole('link', { name: 'Phone verification' });
    expect(inactiveTab).toHaveClass('border-l-transparent', 'text-fg-3');

    // Vertical reads the active count at `fg-3`, one shade darker than the horizontal strip's
    // `fg-4` — see the compound-variant test below for the two orientations side by side.
    const activeCount = activeTab.querySelector('span');
    expect(activeCount).toHaveClass('font-mono', 'ml-auto', 'text-caps-tiny', 'text-fg-3');
    expect(activeCount).not.toHaveClass('text-fg-4');
  });

  it('gives the active count a darker colour vertically than horizontally', () => {
    renderTabs();
    const horizontalActiveCount = screen
      .getByRole('link', { name: 'All 128' })
      .querySelector('span');
    expect(horizontalActiveCount).toHaveClass('text-fg-4');
    expect(horizontalActiveCount).not.toHaveClass('text-fg-3');

    renderVerticalTabs();
    const verticalActiveCount = screen
      .getByRole('link', { name: 'Identity verification 2' })
      .querySelector('span');
    expect(verticalActiveCount).toHaveClass('text-fg-3');
    expect(verticalActiveCount).not.toHaveClass('text-fg-4');
  });

  it('marks the active tab in both orientations, and only that one', () => {
    renderVerticalTabs();

    expect(screen.getByRole('link', { name: 'Identity verification 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Phone verification' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('renders a count in both orientations when given, and nothing when omitted', () => {
    renderVerticalTabs();

    expect(screen.getByRole('link', { name: 'Identity verification 2' })).toHaveTextContent(
      'Identity verification 2',
    );
    expect(screen.getByRole('link', { name: 'Phone verification' })).toHaveTextContent(
      /^Phone verification$/,
    );
  });

  it('renders a zero count in the vertical orientation rather than treating it as omitted', () => {
    render(
      <MemoryRouter>
        <FilterTabs label="Connector type" orientation="vertical">
          <FilterTabGroup label="Connector type">
            <FilterTab to="/connectors?type=custom" active count={0}>
              Custom
            </FilterTab>
          </FilterTabGroup>
        </FilterTabs>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Custom 0' })).toHaveTextContent('Custom 0');
  });

  it('renders a FilterTabNote as plain text with no link role', () => {
    renderVerticalTabs();

    const note = screen.getByText('Business verification');
    expect(note.tagName).toBe('SPAN');
    expect(note).not.toHaveAttribute('href');
    expect(screen.queryByRole('link', { name: 'Business verification' })).not.toBeInTheDocument();
  });
});
