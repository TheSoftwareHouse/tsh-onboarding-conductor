import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandLockup } from './BrandLockup';

afterEach(() => {
  cleanup();
});

describe('BrandLockup', () => {
  it('renders the signet and both labels', () => {
    render(<BrandLockup />);

    expect(screen.getByRole('img', { name: 'TSH' })).toBeInTheDocument();
    expect(screen.getByText('Conductor')).toBeInTheDocument();
    expect(screen.getByText('Onboarding ops')).toBeInTheDocument();
  });
});
