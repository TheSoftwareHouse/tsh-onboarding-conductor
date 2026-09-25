import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Thrown when an operator tries to turn encryption on, or rotate its key, on an engine process
 * that has no key-encryption key (`ENCRYPTION_KEY`) configured: there is nothing to wrap a data
 * key with. A `503` like the other configuration gaps (`CONNECTOR_NOT_CONFIGURED`), since the
 * request is well-formed and the deployment, not the caller, is what has to change.
 */
export class EncryptionKeyNotConfiguredException extends ServiceUnavailableException {
  static readonly apiDescription =
    'This engine process has no `ENCRYPTION_KEY` configured, so it can neither create nor wrap a ' +
    'data key; configure the key-encryption key and restart the engine.';

  constructor() {
    super({
      code: 'ENCRYPTION_KEY_NOT_CONFIGURED',
      message: 'ENCRYPTION_KEY_NOT_CONFIGURED',
    });
  }
}
