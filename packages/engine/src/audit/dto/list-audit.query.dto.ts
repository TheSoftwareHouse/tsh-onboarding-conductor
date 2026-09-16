import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { PaginationQueryDto } from '../../pagination';

function isStrictIso8601DateTime(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

function IsStrictIso8601DateTime(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: StrictIso8601DateTimeConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'strictIso8601DateTime', async: false })
class StrictIso8601DateTimeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isStrictIso8601DateTime(value);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be a valid ISO-8601 datetime string`;
  }
}

@ValidatorConstraint({ name: 'strictIso8601DateTimeBounds', async: false })
class StrictIso8601DateTimeBoundsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const object = args.object as { occurredFrom?: string; occurredTo?: string };

    if (object.occurredFrom === undefined || value === undefined) {
      return true;
    }

    if (typeof object.occurredFrom !== 'string' || typeof value !== 'string') {
      return false;
    }

    if (!isStrictIso8601DateTime(object.occurredFrom) || !isStrictIso8601DateTime(value)) {
      return false;
    }

    return new Date(object.occurredFrom).getTime() <= new Date(value).getTime();
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must not be later than occurredFrom`;
  }
}

export class ListAuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 64, description: 'Only events by this actor type.' })
  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(64)
  actorType?: string;

  @ApiPropertyOptional({ maxLength: 255, description: 'Only events by this actor.' })
  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(255)
  actorId?: string;

  @ApiPropertyOptional({ maxLength: 255, description: 'Only events with this action name.' })
  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(255)
  action?: string;

  @ApiPropertyOptional({ maxLength: 64, description: 'Only events about this resource type.' })
  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(64)
  resourceType?: string;

  @ApiPropertyOptional({ maxLength: 255, description: 'Only events about this resource.' })
  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(255)
  resourceId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Only events at or after this instant. ISO-8601 with seconds and an offset or `Z`; other ' +
      'forms are refused rather than guessed at.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed === '' ? value : trimmed;
  })
  @IsStrictIso8601DateTime({ message: 'occurredFrom must be a valid ISO-8601 datetime string' })
  occurredFrom?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Only events at or before this instant; must not precede `occurredFrom`.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed === '' ? value : trimmed;
  })
  @IsStrictIso8601DateTime({ message: 'occurredTo must be a valid ISO-8601 datetime string' })
  @Validate(StrictIso8601DateTimeBoundsConstraint, {
    message: 'occurredFrom must not be later than occurredTo',
  })
  occurredTo?: string;
}
