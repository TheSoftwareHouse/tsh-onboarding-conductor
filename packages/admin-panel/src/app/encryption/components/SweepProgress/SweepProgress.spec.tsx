import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SweepProgress } from './SweepProgress';

afterEach(() => {
  cleanup();
});

describe('SweepProgress', () => {
  it('describes the sweep onto the active key while encryption is on', () => {
    render(<SweepProgress enabled progress={{ pending: 3, total: 10 }} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Encrypting stored onboardings onto the active key: 7 of 10 done, 3 remaining.',
    );
  });

  it('describes the sweep back to plain JSON while encryption is off', () => {
    render(<SweepProgress enabled={false} progress={{ pending: 12, total: 12 }} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Decrypting stored onboardings: 0 of 12 done, 12 remaining.',
    );
  });

  it('renders nothing once nothing is pending', () => {
    const { container } = render(<SweepProgress enabled progress={{ pending: 0, total: 10 }} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
