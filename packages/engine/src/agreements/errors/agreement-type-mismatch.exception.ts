import { BadRequestException } from '@nestjs/common';
import { type AgreementType } from '../agreement.types';

/**
 * A publish named an existing family with a different `type`. The classification belongs to the
 * family rather than to one version, so accepting this would leave `eu-b2c-terms` reading as
 * terms at v1 and as a privacy notice at v2.
 */
export class AgreementTypeMismatchException extends BadRequestException {
  static readonly apiDescription =
    '`key` is already published under another type; `publishedType` and `requestedType` name ' +
    'the two. The type belongs to the family and cannot change between versions.';

  constructor(key: string, publishedType: AgreementType, requestedType: AgreementType) {
    super({
      code: 'AGREEMENT_TYPE_MISMATCH',
      message: 'AGREEMENT_TYPE_MISMATCH',
      key,
      publishedType,
      requestedType,
    });
  }
}
