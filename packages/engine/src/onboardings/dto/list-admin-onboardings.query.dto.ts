import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CONNECTOR_ID_PATTERN } from '../../connectors/ports/connector-execution.port';
import { WORKFLOW_STATUSES, type WorkflowStatus } from '@tsh/ddl-schema';
import {
  ONBOARDING_AGREEMENT_STATUSES,
  type OnboardingAgreementStatus,
} from '../../agreements/agreement.types';
import { ONBOARDING_AGREEMENT_STATUS_ENUM, WORKFLOW_STATUS_ENUM } from '../../openapi/api-enums';
import { PaginationQueryDto } from '../../pagination';

/**
 * Filter criteria the admin onboardings list accepts, on top of the inherited `page`/`limit`
 * window. The list is paginated server-side; the export route reuses these criteria without the
 * window.
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

  /**
   * The derived agreement status, as the `onboarding_agreement_statuses` view computes it.
   * Narrowed to the three declared values, so an unknown label is a 400 rather than a page that
   * silently matches nothing.
   */
  @ApiPropertyOptional({
    ...ONBOARDING_AGREEMENT_STATUS_ENUM,
    description: 'Only onboardings whose derived agreement status is this one.',
  })
  @IsOptional()
  @IsString()
  @IsIn(ONBOARDING_AGREEMENT_STATUSES)
  agreementStatus?: OnboardingAgreementStatus;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Only onboardings parked on an asynchronous connector (`true`), or only those not parked ' +
      '(`false`).',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  parked?: boolean;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Only onboardings parked on this connector id.',
  })
  @IsOptional()
  @IsString()
  @Matches(CONNECTOR_ID_PATTERN)
  @MaxLength(100)
  pendingConnectorId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Only onboardings parked before this instant, by the park time the engine recorded. A row ' +
      'parked before that time was recorded never matches.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  parkedBefore?: string;
}
