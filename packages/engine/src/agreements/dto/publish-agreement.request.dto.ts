import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { AGREEMENT_TYPE_ENUM } from '../../openapi/api-enums';
import { AGREEMENT_TYPES, type AgreementType } from '../agreement.types';

/**
 * Lowercase letters, digits and dashes, opening on an alphanumeric. The same shape a workflow
 * step's `agreements[].key` must take, so a family published here can actually be named by a
 * document.
 */
export const AGREEMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * `POST /v1/admin/agreements`. The version is the engine's to derive, so the body never states
 * one, and there is no `name`: `key` and `type` identify the family, and a label on a version row
 * would drift between versions of one family.
 */
export class PublishAgreementRequestDto {
  @ApiProperty({
    maxLength: 100,
    pattern: AGREEMENT_KEY_PATTERN.source,
    description:
      'The family to publish the next version of: lowercase letters, digits and dashes, opening ' +
      "on an alphanumeric, the same shape a workflow's `agreements[].key` takes. A key nobody has " +
      'published starts a new family at version 1.',
    example: 'eu-b2c-terms',
  })
  @IsString()
  @MaxLength(100)
  @Matches(AGREEMENT_KEY_PATTERN)
  key!: string;

  @ApiProperty({
    ...AGREEMENT_TYPE_ENUM,
    description:
      "The family's classification. Must match the type of every version already published " +
      'under `key`.',
  })
  @IsIn(AGREEMENT_TYPES)
  type!: AgreementType;
}
