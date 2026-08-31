import { HttpException, HttpStatus } from '@nestjs/common';

export type CallbackSignatureRejectionReason =
  | 'callback_auth_not_declared'
  | 'signature_header_missing'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'signing_secret_missing'
  | 'timestamp_header_missing'
  | 'timestamp_out_of_tolerance'
  | 'unsigned_connector_not_allowed';

// Sumsub (and providers with the same policy) treat 401/403/404 as permanent and never
// redeliver. These two reasons describe a gap in our own configuration, not a bad
// caller, so they answer 503 instead — honest about being unable to verify anything
// right now, and it buys the provider's full retry budget to land inside the fix window.
const CONFIGURATION_GAP_REASONS: ReadonlySet<CallbackSignatureRejectionReason> = new Set([
  'callback_auth_not_declared',
  'signing_secret_missing',
]);

function statusForReason(reason: CallbackSignatureRejectionReason): HttpStatus {
  return CONFIGURATION_GAP_REASONS.has(reason)
    ? HttpStatus.SERVICE_UNAVAILABLE
    : HttpStatus.UNAUTHORIZED;
}

/**
 * Every verification failure answers with the same opaque `{code, message}` contract so
 * a caller cannot tell a missing header from a wrong secret. The precise reason stays
 * server-side, on this field, for the audit log. Only the HTTP status varies, by reason
 * — see `statusForReason`.
 */
export class CallbackSignatureInvalidException extends HttpException {
  constructor(readonly reason: CallbackSignatureRejectionReason) {
    super(
      {
        code: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
        message: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
      },
      statusForReason(reason),
    );
  }
}
