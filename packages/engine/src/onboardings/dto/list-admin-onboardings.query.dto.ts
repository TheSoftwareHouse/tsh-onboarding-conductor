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

export class ListAdminOnboardingsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['awaiting_user', 'awaiting_manual_review', 'approved', 'rejected'])
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
