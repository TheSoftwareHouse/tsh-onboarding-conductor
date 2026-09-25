import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSO_PROVIDERS } from '@/services/auth/auth-config';
import { SignInPage } from './SignInPage';

const { mockedUseMsal, mockedReadAuthConfig } = vi.hoisted(() => ({
  mockedUseMsal: vi.fn(),
  mockedReadAuthConfig: vi.fn(),
}));

vi.mock('@/services/auth/auth-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/auth/auth-config')>()),
  readAuthConfig: mockedReadAuthConfig,
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: mockedUseMsal,
}));

const API_SCOPE = 'api://engine-id/Onboardings.Read';

function stubMsal(loginRedirect = vi.fn(() => Promise.resolve())) {
  mockedUseMsal.mockReturnValue({ instance: { loginRedirect } });

  return loginRedirect;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedReadAuthConfig.mockReturnValue({
    provider: 'azure',
    clientId: 'client-id',
    tenantId: 'tenant-id',
    apiScope: API_SCOPE,
  });
  stubMsal();
});

afterEach(() => {
  cleanup();
});

describe('SignInPage', () => {
  it('labels the button for the configured SSO provider', () => {
    // The label comes from the provider registry rather than being hard-coded, so switching the
    // panel to another directory does not leave it inviting operators to sign in with Microsoft.
    render(<SignInPage />);

    expect(
      screen.getByRole('button', { name: SSO_PROVIDERS.azure.signInLabel }),
    ).toBeInTheDocument();
  });

  it('offers sign-in and shows no error before anything has been tried', () => {
    render(<SignInPage />);

    expect(screen.getByRole('heading', { name: 'Admin onboardings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the title as the page’s single level-1 heading', () => {
    render(<SignInPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin onboardings' }),
    ).toBeInTheDocument();
  });

  it('renders the brand lockup in the header', () => {
    render(<SignInPage />);

    expect(
      within(screen.getByRole('banner')).getByRole('img', { name: 'TSH' }),
    ).toBeInTheDocument();
  });

  it('keeps the trailing arrow out of the button’s accessible name', () => {
    render(<SignInPage />);

    expect(screen.getByRole('button')).toHaveAccessibleName(SSO_PROVIDERS.azure.signInLabel);
  });

  it('requests the engine scope up front so the first data call is served from cache', async () => {
    // Asking for consent during sign-in avoids a second interactive prompt on the first request.
    const loginRedirect = stubMsal();
    render(<SignInPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    expect(loginRedirect).toHaveBeenCalledWith({ scopes: [API_SCOPE] });
  });

  it('reports a redirect that could not even be started', async () => {
    const loginRedirect = vi.fn(() => Promise.reject(new Error('popup blocked')));
    stubMsal(loginRedirect);
    render(<SignInPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('popup blocked'));
  });

  it('reports a non-Error rejection without rendering an unhelpful object', async () => {
    stubMsal(vi.fn(() => Promise.reject('something odd')));
    render(<SignInPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Sign-in could not be started.'),
    );
  });

  it('shows a failure carried over from an earlier redirect', () => {
    render(<SignInPage error="Sign-in failed (AADSTS50011): redirect URI mismatch" />);

    expect(screen.getByRole('alert')).toHaveTextContent('AADSTS50011');
  });

  it('lets a fresh attempt supersede the error the gate handed it', async () => {
    const loginRedirect = vi.fn(() => Promise.reject(new Error('popup blocked')));
    stubMsal(loginRedirect);
    render(<SignInPage error="Sign-in failed (AADSTS50011): redirect URI mismatch" />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('popup blocked'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('AADSTS50011');
  });
});
