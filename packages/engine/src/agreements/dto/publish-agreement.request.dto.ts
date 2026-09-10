import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
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
  @IsString()
  @MaxLength(100)
  @Matches(AGREEMENT_KEY_PATTERN)
  key!: string;

  @IsIn(AGREEMENT_TYPES)
  type!: AgreementType;
}
