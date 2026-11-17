import { readRuntimeEnv } from '@/config/runtime-env';

function readValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

/**
 * Sign-in is on unless it is explicitly switched off, so a build that forgets to configure the
 * flag is gated rather than open.
 */
export function isAuthEnabled(): boolean {
  return readValue(readRuntimeEnv().VITE_AUTH_ENABLED)?.toLowerCase() !== 'false';
}

/**
 * Whether the engine has Microsoft sign-in configured. The engine derives the flag from its own
 * Microsoft settings when it renders `/config.js`, so the panel never sees a secret. Off unless
 * it is explicitly `true`: a missing flag must not show a button the engine cannot honour.
 */
export function isMicrosoftSignInEnabled(): boolean {
  return readValue(readRuntimeEnv().VITE_AUTH_MICROSOFT_ENABLED)?.toLowerCase() === 'true';
}

/**
 * Whether a superadmin must enroll TOTP. Required unless the engine explicitly renders `false`;
 * the engine enforces the same rule, so this only decides whether the setup screen can be skipped.
 */
export function isSuperadminTwoFactorRequired(): boolean {
  return (
    readValue(readRuntimeEnv().VITE_AUTH_SUPERADMIN_TWO_FACTOR_REQUIRED)?.toLowerCase() !== 'false'
  );
}
