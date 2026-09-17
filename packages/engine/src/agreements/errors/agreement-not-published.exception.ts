import { ServiceUnavailableException } from '@nestjs/common';

/**
 * A workflow step declares an agreement family that has no published version, hit when an
 * onboarding starts. An operator's configuration gap rather than a user's mistake — the same
 * reading as `CONNECTOR_NOT_CONFIGURED`, and the same status, because the request would succeed
 * unchanged once the version is published.
 */
export class AgreementNotPublishedException extends ServiceUnavailableException {
  static readonly apiDescription =
    'The workflow declares an agreement family nobody has published a version of; `key` names ' +
    'it. An operator publishes one and the same request then succeeds.';

  constructor(key: string) {
    super({
      code: 'AGREEMENT_NOT_PUBLISHED',
      message: 'AGREEMENT_NOT_PUBLISHED',
      key,
    });
  }
}
