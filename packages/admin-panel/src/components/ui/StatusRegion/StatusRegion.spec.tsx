import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusRegion } from './StatusRegion';

afterEach(() => {
  cleanup();
});

describe('StatusRegion', () => {
  it('announces its content as a polite status region by default', () => {
    render(<StatusRegion>Showing 1-20 of 128 onboardings</StatusRegion>);

    const region = screen.getByRole('status');

    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Showing 1-20 of 128 onboardings');
  });

  it('turns the live region off when live is false', () => {
    render(<StatusRegion live={false}>Loading</StatusRegion>);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'off');
  });

  it('forwards a className so a page can place it', () => {
    render(<StatusRegion className="ml-auto">Showing 1-20 of 128 onboardings</StatusRegion>);

    expect(screen.getByRole('status')).toHaveClass('ml-auto');
  });
});
