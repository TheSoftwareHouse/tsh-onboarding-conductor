import { Injectable } from '@nestjs/common';
import {
  ConnectorFailureAction,
  DEFAULT_CONNECTOR_ERROR_HANDLER_ID,
  type ConnectorErrorHandler,
  type ConnectorFailure,
} from '../../ports/connector-error-handler.port';

/**
 * Falls back when one is available, else propagates. The default a declaration gets when it
 * names no `errorHandler` — declaring a `fallback` is enough to get one.
 */
@Injectable()
export class FallbackOnErrorHandler implements ConnectorErrorHandler {
  readonly id = DEFAULT_CONNECTOR_ERROR_HANDLER_ID;

  handle(failure: ConnectorFailure): ConnectorFailureAction {
    return failure.fallbackAvailable
      ? ConnectorFailureAction.FALLBACK
      : ConnectorFailureAction.PROPAGATE;
  }
}
