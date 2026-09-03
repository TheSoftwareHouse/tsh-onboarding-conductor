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
 * Columns the admin list may be ordered by. `createdAt` is the default because it is the order the
 * list has always had; `score` is what makes that column worth showing — a paginated list an
 * operator cannot sort does not let them find the low scorers without paging through everything.
 * `completedAt` is nullable, which is why the repository pins where its empty rows land.
 */
export const ADMIN_ONBOARDING_SORT_FIELDS = ['createdAt', 'completedAt', 'score'] as const;

export type AdminOnboardingSortField = (typeof ADMIN_ONBOARDING_SORT_FIELDS)[number];

export const ADMIN_ONBOARDING_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type AdminOnboardingSortDirection = (typeof ADMIN_ONBOARDING_SORT_DIRECTIONS)[number];

/** Defaults reproduce the ordering the list had before it could be sorted at all. */
export const DEFAULT_ADMIN_ONBOARDING_SORT_FIELD: AdminOnboardingSortField = 'createdAt';
export const DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION: AdminOnboardingSortDirection = 'desc';

/** Query-string integers arrive as strings; a leading `-` is kept because a score may be negative. */
const toOptionalInteger = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === '' || !/^[+-]?\d+$/.test(trimmedValue)) {
    return value;
  }

  return Number(trimmedValue);
};

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

  /** Inclusive lower bound on the accumulated score. Negative values are legitimate. */
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(toOptionalInteger)
  @IsInt()
  minScore?: number;

  /** Inclusive upper bound on the accumulated score. Negative values are legitimate. */
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(toOptionalInteger)
  @IsInt()
  maxScore?: number;

  @IsOptional()
  @IsString()
  @IsIn(ADMIN_ONBOARDING_SORT_FIELDS)
  sortBy?: AdminOnboardingSortField;

  @IsOptional()
  @IsString()
  @IsIn(ADMIN_ONBOARDING_SORT_DIRECTIONS)
  sortDir?: AdminOnboardingSortDirection;
}
