/**
 * Thrown when a column transformer needs the encryption port before `EncryptionModule` has
 * initialised it — a misordered bootstrap. Never defaults to a pass-through: a query that runs
 * before the registry is populated must fail loudly rather than risk persisting plaintext into a
 * column the operator believes is encrypted.
 */
export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      'No encryption port has been set. EncryptionModule must initialise before any entity ' +
        'operation runs.',
    );
    this.name = 'EncryptionUnavailableError';
  }
}
