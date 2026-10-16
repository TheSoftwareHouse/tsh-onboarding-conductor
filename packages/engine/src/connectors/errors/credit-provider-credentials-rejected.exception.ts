import { ServiceUnavailableException } from '@nestjs/common';

export class CreditProviderCredentialsRejectedException extends ServiceUnavailableException {
  static readonly apiDescription =
    'The credit provider refused the credentials stored for the connector (wrong client id or ' +
    'secret, or a product the account lacks). An operator fixes the connector settings; the ' +
    'onboarding stays where it was. Carries `connectorId`.';

  constructor(connectorId: string) {
    super({
      code: 'CREDIT_PROVIDER_CREDENTIALS_REJECTED',
      message: 'CREDIT_PROVIDER_CREDENTIALS_REJECTED',
      connectorId,
    });
  }
}
