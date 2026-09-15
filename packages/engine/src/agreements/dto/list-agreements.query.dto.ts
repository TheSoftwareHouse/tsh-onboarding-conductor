import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AGREEMENT_TYPE_ENUM } from '../../openapi/api-enums';
import { PaginationQueryDto } from '../../pagination';
import { AGREEMENT_TYPES, type AgreementType } from '../agreement.types';
import { AGREEMENT_KEY_PATTERN } from './publish-agreement.request.dto';

/**
 * What `GET /v1/admin/agreements` narrows on, on top of the inherited `page`/`limit` window.
 * Every published version of every family is listed by default, newest version first within a
 * family.
 */
export class ListAgreementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    pattern: AGREEMENT_KEY_PATTERN.source,
    description: 'Only versions of this family.',
    example: 'eu-b2c-terms',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(AGREEMENT_KEY_PATTERN)
  key?: string;

  @ApiPropertyOptional({ ...AGREEMENT_TYPE_ENUM, description: 'Only families of this type.' })
  @IsOptional()
  @IsIn(AGREEMENT_TYPES)
  type?: AgreementType;
}
