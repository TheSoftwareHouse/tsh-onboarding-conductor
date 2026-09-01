import { Injectable } from '@nestjs/common';
import {
  ConnectorFailureAction,
  type ConnectorErrorHandler,
} from '../../ports/connector-error-handler.port';

/**
 * Always continues. For a connector whose failure must not block the onboarding — the chain
 * proceeds as if this slot had been accepted.
 */
@Injectable()
export class ContinueOnErrorHandler implements ConnectorErrorHandler {
  readonly id = 'continue_on_error';

  handle(): ConnectorFailureAction {
    return ConnectorFailureAction.CONTINUE;
  }
}
