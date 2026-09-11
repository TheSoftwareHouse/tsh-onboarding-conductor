import { ValidationError } from '@nestjs/common';
import { ValidationFailedException } from './errors/validation-failed.exception';

/**
 * Wired into every `ValidationPipe` in the app (`main.ts`'s global pipe, `AuditController`'s
 * route-local pipe) so DTO rejections carry structured, value-free field errors for the audit
 * filter without changing the response body `ValidationPipe` produces by default.
 */
export function exceptionFactory(
  validationErrors: ValidationError[] = [],
): ValidationFailedException {
  return new ValidationFailedException(validationErrors);
}
