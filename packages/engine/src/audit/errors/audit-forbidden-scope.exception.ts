import { HttpException, HttpStatus } from '@nestjs/common';

export class AuditForbiddenScopeException extends HttpException {
  constructor() {
    super(
      {
        code: 'FORBIDDEN_SCOPE',
        message: 'FORBIDDEN_SCOPE',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
