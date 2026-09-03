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

const isClientError = (status: number | undefined): boolean =>
  status !== undefined &&
  status >= CLIENT_ERROR_STATUS_LOWER_BOUND &&
  status <= CLIENT_ERROR_STATUS_UPPER_BOUND;

/**
 * "On 500, retries": a 4xx status is treated as unrepeatable and goes straight to
 * fallback-or-propagate. A 5xx or statusless failure is retried for as long as the declaration's
 * own `retry.maxAttempts` allows, then falls back or propagates.
 *
 * How many attempts that is comes from the workflow document rather than from a constant here, so
 * an operator changes it by editing `retry` — with the default policy it is one retry, which is
 * what this handler has always done.
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

    if (failure.attempt < failure.retry.maxAttempts) {
      return ConnectorFailureAction.RETRY;
    }

    return failure.fallbackAvailable
      ? ConnectorFailureAction.FALLBACK
      : ConnectorFailureAction.PROPAGATE;
  }
}
