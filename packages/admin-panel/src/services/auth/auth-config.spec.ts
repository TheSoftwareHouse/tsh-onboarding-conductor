import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthEnabled, isMicrosoftSignInEnabled } from './auth-config';

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__ENV__;
});

describe('isAuthEnabled', () => {
  it('is enabled when the flag is not configured, so a build cannot forget to gate itself', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', undefined);

    expect(isAuthEnabled()).toBe(true);
  });

  it('is enabled for any value other than false', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');

    expect(isAuthEnabled()).toBe(true);
  });

  it('is disabled only for an explicit false, regardless of casing or padding', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', ' False ');

    expect(isAuthEnabled()).toBe(false);
  });

  it('a runtime VITE_AUTH_ENABLED overrides a conflicting build-time value', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    window.__ENV__ = { VITE_AUTH_ENABLED: 'false' };

    expect(isAuthEnabled()).toBe(false);
  });
});

describe('isMicrosoftSignInEnabled', () => {
  it('is off when the engine did not render the flag', () => {
    vi.stubEnv('VITE_AUTH_MICROSOFT_ENABLED', undefined);

    expect(isMicrosoftSignInEnabled()).toBe(false);
  });

  it('is on for true, regardless of casing or padding', () => {
    vi.stubEnv('VITE_AUTH_MICROSOFT_ENABLED', ' True ');

    expect(isMicrosoftSignInEnabled()).toBe(true);
  });

  it('is off for any other value', () => {
    vi.stubEnv('VITE_AUTH_MICROSOFT_ENABLED', 'yes');

    expect(isMicrosoftSignInEnabled()).toBe(false);
  });

  it('a runtime value overrides a conflicting build-time one', () => {
    vi.stubEnv('VITE_AUTH_MICROSOFT_ENABLED', 'false');
    window.__ENV__ = { VITE_AUTH_MICROSOFT_ENABLED: 'true' };

    expect(isMicrosoftSignInEnabled()).toBe(true);
  });
});
