import { applyDecorators, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiErrorResponses, frameworkError } from '../openapi/api-error-responses.decorator';
import { ADMIN_BEARER_AUTH } from '../openapi/openapi.constants';
import { AzureJwtGuard } from './azure-jwt.guard';

/**
 * Marks a handler as part of the admin surface: guards it with `AzureJwtGuard` and documents that
 * guard's contract in the same decorator, so the OpenAPI document can neither claim a route is
 * protected when it is not nor stay silent about one that is. Applied per route rather than per
 * controller because `OnboardingsController` mixes the public flow with admin reads.
 */
export function AdminRoute(): MethodDecorator {
  return applyDecorators(
    UseGuards(AzureJwtGuard),
    ApiBearerAuth(ADMIN_BEARER_AUTH),
    ApiErrorResponses(
      frameworkError(
        HttpStatus.UNAUTHORIZED,
        'No bearer token, or the token fails signature, issuer, audience or expiry verification.',
      ),
      frameworkError(
        HttpStatus.FORBIDDEN,
        'The token verifies but its `roles` claim holds none of `ADMIN_REQUIRED_ROLES`; signing in ' +
          'again cannot fix this.',
      ),
      frameworkError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "Entra's signing key set could not be reached, so the token was never judged. Retry.",
      ),
    ),
  );
}
