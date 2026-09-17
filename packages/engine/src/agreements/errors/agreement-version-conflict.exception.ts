import { ConflictException } from '@nestjs/common';

/**
 * Two publishes on one family derived the same next version and the loser hit
 * `UNIQUE (key, version)`. A conflict rather than a server error: nothing is wrong, the caller
 * simply lost a race and can publish again against the version that won.
 */
export class AgreementVersionConflictException extends ConflictException {
  static readonly apiDescription =
    'A concurrent publish of `key` won the same version number. Nothing is wrong; publish again.';

  constructor(key: string) {
    super({
      code: 'AGREEMENT_VERSION_CONFLICT',
      message: 'AGREEMENT_VERSION_CONFLICT',
      key,
    });
  }
}
