import { NotFoundException } from '@nestjs/common';

export class SessionNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'SESSION_NOT_FOUND', message: 'SESSION_NOT_FOUND' });
  }
}
