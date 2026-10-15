import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Callout } from './Callout';

afterEach(() => {
  cleanup();
});

describe('Callout', () => {
  it('renders the copy a caller passes it, beside a decorative icon', () => {
    render(
      <Callout>
        Definitions are discovered from <code>workflows/</code> at engine start.
      </Callout>,
    );

    expect(
      screen.getByText(/Definitions are discovered from/, { selector: 'p' }),
    ).toBeInTheDocument();
    // The icon is decorative: the copy alone carries the band's meaning.
    expect(document.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('renders the notice variant as a tinted, bordered status band', () => {
    render(
      <Callout variant="notice" role="status">
        Heads up
      </Callout>,
    );

    const band = screen.getByRole('status');
    expect(band).toHaveTextContent('Heads up');
    expect(band).toHaveClass('border', 'bg-tsh-yellow-200');
    expect(band).not.toHaveClass('border-b');
  });
});
