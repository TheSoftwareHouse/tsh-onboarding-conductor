import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';

const { mockedIsAuthEnabled, mockedGetMsalInstance, mockedMsalProvider } = vi.hoisted(() => ({
  mockedIsAuthEnabled: vi.fn<() => boolean>(),
  mockedGetMsalInstance: vi.fn(),
  mockedMsalProvider: vi.fn(),
}));

vi.mock('@/services/auth/auth-config', () => ({
  isAuthEnabled: mockedIsAuthEnabled,
}));

vi.mock('@/services/auth/msal-instance', () => ({
  getMsalInstance: mockedGetMsalInstance,
}));

vi.mock('@azure/msal-react', () => ({
  MsalProvider: (props: { children: ReactNode; instance: unknown }) => {
    mockedMsalProvider(props.instance);

    return <div data-testid="msal-provider">{props.children}</div>;
  },
}));

const INSTANCE = { id: 'msal-instance' };

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsAuthEnabled.mockReturnValue(true);
  mockedGetMsalInstance.mockReturnValue(INSTANCE);
});

afterEach(() => {
  cleanup();
});

describe('AuthProvider', () => {
  it('passes children straight through when sign-in is switched off', () => {
    // The point of the flag: local work must not need an Entra tenant to render the panel.
    mockedIsAuthEnabled.mockReturnValue(false);

    render(
      <AuthProvider>
        <p>panel</p>
      </AuthProvider>,
    );

    expect(screen.getByText('panel')).toBeInTheDocument();
    expect(screen.queryByTestId('msal-provider')).not.toBeInTheDocument();
  });

  it('constructs no MSAL client at all when sign-in is switched off', () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    render(
      <AuthProvider>
        <p>panel</p>
      </AuthProvider>,
    );

    expect(mockedGetMsalInstance).not.toHaveBeenCalled();
  });

  it('supplies the shared client to the tree when sign-in is on', () => {
    render(
      <AuthProvider>
        <p>panel</p>
      </AuthProvider>,
    );

    expect(screen.getByTestId('msal-provider')).toBeInTheDocument();
    expect(mockedMsalProvider).toHaveBeenCalledWith(INSTANCE);
    expect(screen.getByText('panel')).toBeInTheDocument();
  });
});
