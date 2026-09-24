import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthShell } from './AuthShell';

afterEach(() => {
  cleanup();
});

describe('AuthShell', () => {
  it('renders the brand in a banner and its children in main', () => {
    render(
      <AuthShell>
        <p>content</p>
      </AuthShell>,
    );

    expect(
      within(screen.getByRole('banner')).getByRole('img', { name: 'TSH' }),
    ).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('content')).toBeInTheDocument();
  });
});
