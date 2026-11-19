import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from './AuthProvider';

afterEach(() => {
  cleanup();
});

describe('AuthProvider', () => {
  it('renders its children', () => {
    render(
      <AuthProvider>
        <p>panel</p>
      </AuthProvider>,
    );

    expect(screen.getByText('panel')).toBeInTheDocument();
  });
});
