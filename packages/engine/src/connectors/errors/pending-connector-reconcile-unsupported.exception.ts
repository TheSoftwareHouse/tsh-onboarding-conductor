import { ConflictException } from '@nestjs/common';

/** `adapter`: the connector has no read-back; `reference_missing`: the park names no attempt to read. */
export type PendingConnectorReconcileUnsupportedReason = 'adapter' | 'reference_missing';

export class PendingConnectorReconcileUnsupportedException extends ConflictException {
  static readonly apiDescription =
    'The parked connector cannot be reconciled: its adapter offers no read-back from the ' +
    'provider (`reason: adapter`), or the park records no provider attempt to read ' +
    '(`reason: reference_missing`). Wait for the callback, or review the onboarding by hand.';

  constructor(connectorId: string, reason: PendingConnectorReconcileUnsupportedReason) {
    super({
      code: 'PENDING_CONNECTOR_RECONCILE_UNSUPPORTED',
      message: 'PENDING_CONNECTOR_RECONCILE_UNSUPPORTED',
      connectorId,
      reason,
    });
  }
}
