import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  Max,
  Min,
  ValidateIf,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

export const DEFAULT_PAGINATION_PAGE = 1;
export const DEFAULT_PAGINATION_LIMIT = 20;

/**
 * Ceiling on how many rows one request may ask for. Shared by every paginated admin endpoint so
 * an operator cannot turn a listing into an unbounded table scan by naming a huge `limit`.
 */
export const MAX_PAGINATION_LIMIT = 100;

/**
 * Whether a raw query value is a plain decimal integer. Deliberately stricter than `Number()`:
 * a repeated query parameter arrives as an array, and forms such as `0x10`, `1e3` or `Infinity`
 * would otherwise coerce to a number and silently mean something other than what was typed.
 */
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

@ValidatorConstraint({ name: 'strictDecimalIntegerQueryValue', async: false })
class StrictDecimalIntegerQueryValueConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isStrictDecimalIntegerQueryValue(value);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be a positive decimal integer query value`;
  }
}

/** Rejects anything that is not a plain decimal integer, before `@IsInt` sees a coerced value. */
export function IsStrictDecimalIntegerQueryValue(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: StrictDecimalIntegerQueryValueConstraint,
    });
  };
}

/**
 * Converts a decimal-integer query string into a number, leaving every other shape untouched so
 * the validators above can refuse it with a message naming the offending property.
 *
 * The raw value is read back off the source object rather than taken from `value`, because
 * class-transformer hands over the class property default when the parameter was omitted, and the
 * default must survive rather than be re-parsed.
 */
export function ToDecimalIntegerQueryValue() {
  return Transform(({ value, obj, key }) => {
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
  });
}

/**
 * The `page`/`limit` window every paginated list endpoint accepts. Query DTOs extend this rather
 * than restating the pair, so one endpoint cannot drift into a different default page size or a
 * laxer notion of what counts as a valid integer.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: DEFAULT_PAGINATION_PAGE,
    description: 'The page to read, counted from 1.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @ToDecimalIntegerQueryValue()
  @IsStrictDecimalIntegerQueryValue()
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGINATION_PAGE;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGINATION_LIMIT,
    default: DEFAULT_PAGINATION_LIMIT,
    description: 'Rows per page.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @ToDecimalIntegerQueryValue()
  @IsStrictDecimalIntegerQueryValue()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGINATION_LIMIT)
  limit: number = DEFAULT_PAGINATION_LIMIT;
}
