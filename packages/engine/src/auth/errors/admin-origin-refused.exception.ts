import { ForbiddenException } from '@nestjs/common';

/** A write sent from a page on another origin. The session cookie travels with any same-site request, so the origin is what tells the panel's own write from a forged one. */
export class AdminOriginRefusedException extends ForbiddenException {
  static readonly apiDescription =
    "A write sent from a page on another origin. The session cookie travels with any same-site request, so the origin is what tells the panel's own write from a forged one.";

  constructor() {
    super({
      code: 'ADMIN_ORIGIN_REFUSED',
      message: 'Admin changes are accepted only from the admin panel.',
    });
  }
}
