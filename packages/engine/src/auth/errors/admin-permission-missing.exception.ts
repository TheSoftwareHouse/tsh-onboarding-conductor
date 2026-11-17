import { ForbiddenException } from '@nestjs/common';

/** The session is valid but neither the platform role nor the active organization grants the permission this route needs; signing in again cannot fix this. */
export class AdminPermissionMissingException extends ForbiddenException {
  static readonly apiDescription =
    'The session is valid but neither the platform role nor the active organization grants the permission this route needs; signing in again cannot fix this.';

  constructor() {
    super({
      code: 'ADMIN_PERMISSION_MISSING',
      message: 'Your account does not have the permission this action needs.',
    });
  }
}
