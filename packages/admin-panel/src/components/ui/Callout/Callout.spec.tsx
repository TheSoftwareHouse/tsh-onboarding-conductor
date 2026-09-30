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
});
