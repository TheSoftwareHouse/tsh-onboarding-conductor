import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import { ApiErrorResponses } from '../openapi/api-error-responses.decorator';
import { ADMIN_SESSION_AUTH } from '../openapi/openapi.constants';
import { ADMIN_PERMISSION_METADATA, AdminSessionGuard } from './admin-session.guard';
import type { AdminPermission } from './domain/admin-permissions';
import { AdminOriginRefusedException } from './errors/admin-origin-refused.exception';
import { AdminPermissionMissingException } from './errors/admin-permission-missing.exception';
import { AdminSessionRequiredException } from './errors/admin-session-required.exception';
import { AuthUnavailableException } from './errors/auth-unavailable.exception';

/**
 * Marks a handler as part of the admin surface: guards it with `AdminSessionGuard`, records the
 * permission the guard checks, and documents the guard's contract in the same decorator, so the
 * OpenAPI document can neither claim a route is protected when it is not nor stay silent about one
 * that is. Applied per route rather than per controller because `OnboardingsController` mixes the
 * public flow with admin reads.
 */
export function AdminRoute(permission: AdminPermission): MethodDecorator {
  return applyDecorators(
    SetMetadata(ADMIN_PERMISSION_METADATA, permission),
    UseGuards(AdminSessionGuard),
    ApiCookieAuth(ADMIN_SESSION_AUTH),
    ApiErrorResponses(
      AdminSessionRequiredException,
      AdminOriginRefusedException,
      AdminPermissionMissingException,
      AuthUnavailableException,
    ),
  );
}
