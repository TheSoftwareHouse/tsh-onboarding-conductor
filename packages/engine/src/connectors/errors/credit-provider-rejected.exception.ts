import { ServiceUnavailableException } from '@nestjs/common';

export class CreditProviderRejectedException extends ServiceUnavailableException {
  static readonly apiDescription =
    'The credit provider refused to start the assessment for a reason that is neither the ' +
    "credentials nor the bank-data document. Carries `connectorId`, the provider's HTTP " +
    '`providerStatus` and, when it sent one, its own `providerCode`; the onboarding stays where ' +
    'it was.';

  constructor(connectorId: string, providerStatus: number, providerCode: string | undefined) {
    super({
      code: 'CREDIT_PROVIDER_REJECTED',
      message: 'CREDIT_PROVIDER_REJECTED',
      connectorId,
      providerStatus,
      ...(providerCode === undefined ? {} : { providerCode }),
    });
  }
}
