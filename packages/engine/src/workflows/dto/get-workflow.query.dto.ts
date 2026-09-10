import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, ValidateIf } from 'class-validator';
import { IsStrictDecimalIntegerQueryValue, ToDecimalIntegerQueryValue } from '../../pagination';

/**
 * The revision a reader may pin the lookup to. Omitting it reads the latest published revision,
 * which is not what a reader looking at an onboarding wants: that onboarding recorded the revision
 * it started on, and pinning it is what keeps the two from drifting apart as revisions are added.
 */
export class GetWorkflowQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description:
      'The revision to read. Omitted, the latest published revision; given, that revision even if ' +
      'it is no longer the latest, as an onboarding pinned to it needs.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsStrictDecimalIntegerQueryValue()
  @ToDecimalIntegerQueryValue()
  @IsInt()
  @Min(1)
  version?: number;
}
