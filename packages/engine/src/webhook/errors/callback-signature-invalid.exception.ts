import { UnauthorizedException } from '@nestjs/common';

export type CallbackSignatureRejectionReason =
  | 'callback_auth_not_declared'
  | 'signature_header_missing'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'signing_secret_missing'
  | 'timestamp_header_missing'
  | 'timestamp_out_of_tolerance'
  | 'unsigned_connector_not_allowed';

/**
 * Every verification failure answers with the same opaque contract so a caller cannot
 * tell a missing header from a wrong secret. The precise reason stays server-side, on
 * this field, for the audit log.
 */
export class CallbackSignatureInvalidException extends UnauthorizedException {
  constructor(readonly reason: CallbackSignatureRejectionReason) {
    super({
      code: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
      message: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
    });
  }
}
