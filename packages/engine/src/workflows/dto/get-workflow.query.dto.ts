import { IsInt, Min, ValidateIf } from 'class-validator';
import { IsStrictDecimalIntegerQueryValue, ToDecimalIntegerQueryValue } from '../../pagination';

/**
 * The revision a reader may pin the lookup to. Omitting it reads the latest published revision,
 * which is not what a reader looking at an onboarding wants: that onboarding recorded the revision
 * it started on, and pinning it is what keeps the two from drifting apart as revisions are added.
 */
export class GetWorkflowQueryDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsStrictDecimalIntegerQueryValue()
  @ToDecimalIntegerQueryValue()
  @IsInt()
  @Min(1)
  version?: number;
}
