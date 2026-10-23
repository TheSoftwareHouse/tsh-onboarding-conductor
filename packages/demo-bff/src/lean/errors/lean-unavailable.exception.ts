import { BadGatewayException } from '@nestjs/common';

/** Lean did not answer, or answered something the widget cannot be started from. */
export class LeanUnavailableException extends BadGatewayException {
  constructor() {
    super({ code: 'LEAN_UNAVAILABLE', message: 'LEAN_UNAVAILABLE' });
  }
}
