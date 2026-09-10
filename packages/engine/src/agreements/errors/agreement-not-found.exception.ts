import { NotFoundException } from '@nestjs/common';

/**
 * The `agreementId` a caller named matches no published version. Distinct from
 * `AGREEMENT_NOT_PUBLISHED`, which is a family nobody has ever published a version of: this one
 * is an id that does not exist.
 */
export class AgreementNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'AGREEMENT_NOT_FOUND',
      message: 'AGREEMENT_NOT_FOUND',
    });
  }
}
