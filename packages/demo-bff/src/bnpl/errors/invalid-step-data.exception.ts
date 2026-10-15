import { BadRequestException } from '@nestjs/common';

import { EngineFieldErrors } from '../../engine/engine-error';

/** The engine rejected the submitted values; `errors` maps a field to `UNKNOWN | REQUIRED | INVALID`. */
export class InvalidStepDataException extends BadRequestException {
  constructor(errors: EngineFieldErrors | undefined) {
    super({ code: 'INVALID_STEP_DATA', message: 'INVALID_STEP_DATA', errors: errors ?? {} });
  }
}
