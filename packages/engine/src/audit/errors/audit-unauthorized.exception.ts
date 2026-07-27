import { HttpException, HttpStatus } from '@nestjs/common';

export class AuditUnauthorizedException extends HttpException {
  constructor() {
    super(
      {
        code: 'UNAUTHORIZED',
        message: 'UNAUTHORIZED',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
