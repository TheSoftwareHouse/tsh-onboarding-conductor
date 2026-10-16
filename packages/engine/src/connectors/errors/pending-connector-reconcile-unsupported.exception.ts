import { ConflictException } from '@nestjs/common';

/**
 * `adapter`: the connector has no read-back; `reference_missing`: the park names no attempt to
 * read; `reference_malformed`: the park names one the adapter cannot read.
 */
export type PendingConnectorReconcileUnsupportedReason =
  'adapter' | 'reference_missing' | 'reference_malformed';

export class PendingConnectorReconcileUnsupportedException extends ConflictException {
  static readonly apiDescription =
    'The parked connector cannot be reconciled: its adapter offers no read-back from the ' +
    'provider (`reason: adapter`), the park records no provider attempt to read ' +
    '(`reason: reference_missing`), or it records one the adapter cannot read ' +
    '(`reason: reference_malformed`). Wait for the callback, or review the onboarding by hand.';

  constructor(connectorId: string, reason: PendingConnectorReconcileUnsupportedReason) {
    super({
      code: 'PENDING_CONNECTOR_RECONCILE_UNSUPPORTED',
      message: 'PENDING_CONNECTOR_RECONCILE_UNSUPPORTED',
      connectorId,
      reason,
    });
  }
}
