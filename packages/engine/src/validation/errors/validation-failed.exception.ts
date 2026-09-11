import { BadRequestException, ValidationError } from '@nestjs/common';
import type { ApiFailureFieldErrors } from '../../audit/audit.types';

/**
 * Thrown by the `exceptionFactory` wired into every `ValidationPipe` in the app. Reproduces
 * Nest's default `ValidationPipe` response body exactly - `{ message: string[], error: 'Bad
 * Request', statusCode: 400 }`, built the same way Nest's own `flattenValidationErrors` builds
 * it - while additionally exposing `fieldErrors`, a value-free map of class-validator constraint
 * *keys* (never their rendered messages, which can echo submitted or allowed values, e.g.
 * `@IsIn`) for the global exception filter to record on the audit row.
 */
export class ValidationFailedException extends BadRequestException {
  readonly fieldErrors: ApiFailureFieldErrors;

  constructor(validationErrors: ValidationError[]) {
    super(flattenValidationErrors(validationErrors));
    this.fieldErrors = collectFieldErrors(validationErrors);
  }
}

/**
 * Mirrors `@nestjs/common`'s `ValidationPipe.flattenValidationErrors` /
 * `mapChildrenToValidationErrors` / `prependConstraintsWithParentProp` exactly, so the response
 * body carried by this exception is byte-identical to Nest's default.
 */
function flattenValidationErrors(validationErrors: ValidationError[]): string[] {
  const messages: string[] = [];

  for (const error of validationErrors) {
    for (const item of mapChildrenToValidationErrors(error)) {
      if (item.constraints) {
        messages.push(...Object.values(item.constraints));
      }
    }
  }

  return messages;
}

function mapChildrenToValidationErrors(
  error: ValidationError,
  parentPath?: string,
): ValidationError[] {
  if (!error.children || error.children.length === 0) {
    return [error];
  }

  const validationErrors: ValidationError[] = [];
  const path = parentPath ? `${parentPath}.${error.property}` : error.property;

  for (const item of error.children) {
    if (item.children && item.children.length > 0) {
      validationErrors.push(...mapChildrenToValidationErrors(item, path));
    }
    validationErrors.push(prependConstraintsWithParentProp(path, item));
  }

  return validationErrors;
}

function prependConstraintsWithParentProp(
  parentPath: string,
  error: ValidationError,
): ValidationError {
  const constraints: Record<string, string> = {};

  for (const key in error.constraints) {
    constraints[key] = `${parentPath}.${error.constraints[key]}`;
  }

  return { ...error, constraints };
}

/**
 * Value-free counterpart to `flattenValidationErrors`: walks the same `ValidationError` tree but
 * keeps constraint *keys* (`isNotEmpty`, `isInt`, `isIn`) instead of their rendered messages,
 * indexed by dot-joined property path.
 */
function collectFieldErrors(
  validationErrors: ValidationError[],
  parentPath?: string,
): Record<string, readonly string[]> {
  const fieldErrors: Record<string, readonly string[]> = {};

  for (const error of validationErrors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      fieldErrors[path] = Object.keys(error.constraints);
    }

    if (error.children && error.children.length > 0) {
      Object.assign(fieldErrors, collectFieldErrors(error.children, path));
    }
  }

  return fieldErrors;
}
