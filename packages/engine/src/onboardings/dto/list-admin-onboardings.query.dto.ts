import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { WORKFLOW_STATUSES, type WorkflowStatus } from '@tsh/ddl-schema';
import { WORKFLOW_STATUS_ENUM } from '../../openapi/api-enums';
import { PaginationQueryDto } from '../../pagination';

/**
 * Filter criteria the admin onboardings list accepts, on top of the inherited `page`/`limit`
 * window. The list is paginated server-side, so an operator can never pull the whole table
 * in one request.
 */
export class ListAdminOnboardingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    ...WORKFLOW_STATUS_ENUM,
    description: 'Only onboardings currently in this status.',
  })
  @IsOptional()
  @IsString()
  @IsIn(WORKFLOW_STATUSES)
  status?: WorkflowStatus;

  @ApiPropertyOptional({ maxLength: 100, description: 'Only onboardings of this workflow.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(100)
  workflowId?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: 'Only onboardings pinned to this workflow revision.',
  })
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

  @ApiPropertyOptional({ maxLength: 100, description: 'Only onboardings waiting on this step.' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(100)
  currentStep?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exactly one onboarding, by id.' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @IsUUID()
  onboardingId?: string;
}
