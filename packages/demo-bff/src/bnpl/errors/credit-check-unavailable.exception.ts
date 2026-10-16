import { ServiceUnavailableException } from '@nestjs/common';

/**
 * The credit provider refused to run the check for a reason that is not the customer's: the
 * engine's connector credentials or the provider's own refusal. An operator's to fix; the
 * customer can try again later.
 */
export class CreditCheckUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({ code: 'CREDIT_CHECK_UNAVAILABLE', message: 'CREDIT_CHECK_UNAVAILABLE' });
  }
}
