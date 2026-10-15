import { BadRequestException } from '@nestjs/common';

export class UnknownPersonaException extends BadRequestException {
  constructor() {
    super({ code: 'UNKNOWN_PERSONA', message: 'UNKNOWN_PERSONA' });
  }
}
