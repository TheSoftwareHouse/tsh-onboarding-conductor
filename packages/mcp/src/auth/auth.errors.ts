/** The caller's token was read and found unacceptable: the caller must sign in again. */
export class TokenRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRejectedError';
  }
}

/**
 * The token could not be judged or exchanged because Entra, or its signing keys, could not be
 * reached or answered unusably. Nothing is known about the token, so it is not a rejected
 * credential and signing in again cannot help.
 */
export class AuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}
