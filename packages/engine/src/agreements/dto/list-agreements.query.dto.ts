import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../pagination';
import { AGREEMENT_TYPES, type AgreementType } from '../agreement.types';
import { AGREEMENT_KEY_PATTERN } from './publish-agreement.request.dto';

/**
 * What `GET /v1/admin/agreements` narrows on, on top of the inherited `page`/`limit` window.
 * Every published version of every family is listed by default, newest version first within a
 * family.
 */
export class ListAgreementsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(AGREEMENT_KEY_PATTERN)
  key?: string;

  @IsOptional()
  @IsIn(AGREEMENT_TYPES)
  type?: AgreementType;
}
