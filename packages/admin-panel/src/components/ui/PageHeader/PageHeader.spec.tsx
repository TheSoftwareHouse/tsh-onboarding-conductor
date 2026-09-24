import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

afterEach(() => {
  cleanup();
});

describe('PageHeader', () => {
  it('titles the page with the one first-level heading it is on', () => {
    render(<PageHeader title="Onboardings" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Onboardings' })).toBeInTheDocument();
  });

  it('places the eyebrow above the title, so the section is named without a second heading', () => {
    render(<PageHeader eyebrow="Monitor" title="Onboardings" />);

    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('renders the actions a page offers beside its title', () => {
    render(
      <PageHeader title="Onboardings">
        <button type="button">Reload</button>
      </PageHeader>,
    );

    expect(screen.getByRole('banner')).toContainElement(
      screen.getByRole('button', { name: 'Reload' }),
    );
  });
});
