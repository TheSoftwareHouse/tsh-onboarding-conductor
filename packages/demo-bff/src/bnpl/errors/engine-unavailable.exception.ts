import { BadGatewayException } from '@nestjs/common';

/** The engine failed in a way the caller cannot act on: 5xx, transport failure or BFF misconfiguration. */
export class EngineUnavailableException extends BadGatewayException {
  constructor() {
    super({ code: 'ENGINE_UNAVAILABLE', message: 'ENGINE_UNAVAILABLE' });
  }
}
