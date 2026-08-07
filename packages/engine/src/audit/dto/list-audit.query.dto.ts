import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

export const DEFAULT_AUDIT_PAGE = 1;
export const DEFAULT_AUDIT_LIMIT = 20;
export const MAX_AUDIT_LIMIT = 100;

function isStrictDecimalIntegerQueryValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return false;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue !== '' && /^\d+$/.test(trimmedValue);
  }

  return typeof value === 'number' && Number.isInteger(value);
}

function IsStrictDecimalIntegerQueryValue(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: StrictDecimalIntegerQueryValueConstraint,
    });
  };
}

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

@ValidatorConstraint({ name: 'strictDecimalIntegerQueryValue', async: false })
class StrictDecimalIntegerQueryValueConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isStrictDecimalIntegerQueryValue(value);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be a positive decimal integer query value`;
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

export class ListAuditQueryDto {
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(({ value, obj, key }) => {
    const rawValue =
      obj !== null && typeof obj === 'object' ? (Reflect.get(obj, key) ?? value) : value;

    if (typeof rawValue !== 'string') {
      return rawValue;
    }

    const trimmedValue = rawValue.trim();

    if (!/^\d+$/.test(trimmedValue)) {
      return rawValue;
    }

    return Number(trimmedValue);
  })
  @IsStrictDecimalIntegerQueryValue()
  @IsInt()
  @Min(1)
  page: number = DEFAULT_AUDIT_PAGE;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(({ value, obj, key }) => {
    const rawValue =
      obj !== null && typeof obj === 'object' ? (Reflect.get(obj, key) ?? value) : value;

    if (typeof rawValue !== 'string') {
      return rawValue;
    }

    const trimmedValue = rawValue.trim();

    if (!/^\d+$/.test(trimmedValue)) {
      return rawValue;
    }

    return Number(trimmedValue);
  })
  @IsStrictDecimalIntegerQueryValue()
  @IsInt()
  @Min(1)
  @Max(MAX_AUDIT_LIMIT)
  limit: number = DEFAULT_AUDIT_LIMIT;

  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(64)
  actorType?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(255)
  actorId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(255)
  action?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(64)
  resourceType?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?!\s*$).+/)
  @MaxLength(255)
  resourceId?: string;

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
