import { authClient } from '@/services/auth/auth-client';
import { unwrap } from '@/services/auth/unwrap-auth-result';

/** `account.providerId` of an email + password account; a Microsoft account has its own. */
const CREDENTIAL_PROVIDER_ID = 'credential';

/** Whether the signed-in operator has a password, which turning two-factor on or off requires. */
export async function fetchHasPassword(): Promise<boolean> {
  const accounts = await unwrap(authClient.listAccounts(), 'Unable to load your account.');
  return accounts.some((account) => account.providerId === CREDENTIAL_PROVIDER_ID);
}

export function disableTwoFactor(password: string) {
  return unwrap(
    authClient.twoFactor.disable({ password }),
    'Unable to turn off two-factor authentication.',
  );
}
