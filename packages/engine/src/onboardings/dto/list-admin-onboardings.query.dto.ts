import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { WORKFLOW_STATUSES } from '@tsh/ddl-schema';
import { PaginationQueryDto } from '../../pagination';

/**
 * Filter criteria the admin onboardings list accepts, on top of the inherited `page`/`limit`
 * window. The list is paginated server-side, so an operator can never pull the whole table
 * in one request.
 */
export class ListAdminOnboardingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(WORKFLOW_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(100)
  workflowId?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmedValue = value.trim();

      if (trimmedValue === '') {
        return value;
      }

      if (!/^[+-]?\d+$/.test(trimmedValue)) {
        return value;
      }

      return Number(trimmedValue);
    }

    return value;
  })
  @IsInt()
  @Min(1)
  workflowVersion?: number;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(100)
  currentStep?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @IsUUID()
  onboardingId?: string;
}
