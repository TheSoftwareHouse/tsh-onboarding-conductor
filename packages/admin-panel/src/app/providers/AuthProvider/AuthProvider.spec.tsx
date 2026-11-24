import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';

const { mockedIsAuthEnabled } = vi.hoisted(() => ({ mockedIsAuthEnabled: vi.fn() }));

vi.mock('@/services/auth/auth-config', () => ({ isAuthEnabled: mockedIsAuthEnabled }));
vi.mock('./SessionCacheGuard/SessionCacheGuard', () => ({
  SessionCacheGuard: () => <p>cache guard</p>,
}));

function renderProvider() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <p>panel</p>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedIsAuthEnabled.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
});

describe('AuthProvider', () => {
  it('renders its children under the session cache guard', () => {
    renderProvider();

    expect(screen.getByText('panel')).toBeInTheDocument();
    expect(screen.getByText('cache guard')).toBeInTheDocument();
  });

  it('mounts no guard while sign-in is off', () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    renderProvider();

    expect(screen.getByText('panel')).toBeInTheDocument();
    expect(screen.queryByText('cache guard')).not.toBeInTheDocument();
  });
});
