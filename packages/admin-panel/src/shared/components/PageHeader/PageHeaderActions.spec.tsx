import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';
import { PageHeaderActions } from './PageHeaderActions';

afterEach(() => {
  cleanup();
});

describe('PageHeaderActions', () => {
  it("portals its children into the mounted PageHeader's action container", () => {
    render(
      <>
        <PageHeader title="Onboardings" />
        <PageHeaderActions>
          <button type="button">Reload</button>
        </PageHeaderActions>
      </>,
    );

    const header = screen.getByRole('banner');

    expect(header).toContainElement(screen.getByRole('button', { name: 'Reload' }));
  });

  it('renders nothing while no PageHeader is mounted to receive it', () => {
    const { container } = render(
      <PageHeaderActions>
        <button type="button">Reload</button>
      </PageHeaderActions>,
    );

    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
