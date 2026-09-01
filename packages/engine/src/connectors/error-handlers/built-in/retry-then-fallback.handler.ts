import { Injectable } from '@nestjs/common';
import {
  ConnectorFailureAction,
  type ConnectorErrorHandler,
  type ConnectorFailure,
} from '../../ports/connector-error-handler.port';

/** Lower bound of the 4xx range: a client-side status is not worth repeating. */
const CLIENT_ERROR_STATUS_LOWER_BOUND = 400;
/** Upper bound of the 4xx range. */
const CLIENT_ERROR_STATUS_UPPER_BOUND = 499;
/** `handle` only retries on a declaration's first failure; every later attempt falls back. */
const FIRST_ATTEMPT = 1;

const isClientError = (status: number | undefined): boolean =>
  status !== undefined &&
  status >= CLIENT_ERROR_STATUS_LOWER_BOUND &&
  status <= CLIENT_ERROR_STATUS_UPPER_BOUND;

/**
 * "On 500, retries": a 4xx status is treated as unrepeatable and goes straight to
 * fallback-or-propagate. A 5xx or statusless failure is retried once, then falls back or
 * propagates.
 */
@Injectable()
export class RetryThenFallbackHandler implements ConnectorErrorHandler {
  readonly id = 'retry_then_fallback';

  handle(failure: ConnectorFailure): ConnectorFailureAction {
    if (isClientError(failure.status)) {
      return failure.fallbackAvailable
        ? ConnectorFailureAction.FALLBACK
        : ConnectorFailureAction.PROPAGATE;
    }

    if (failure.attempt === FIRST_ATTEMPT) {
      return ConnectorFailureAction.RETRY;
    }

    return failure.fallbackAvailable
      ? ConnectorFailureAction.FALLBACK
      : ConnectorFailureAction.PROPAGATE;
  }
}
