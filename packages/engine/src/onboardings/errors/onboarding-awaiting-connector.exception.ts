import { ConflictException } from '@nestjs/common';
import type { ConnectorPendingExecution } from '../../connectors/ports/connector-execution-result';

export class OnboardingAwaitingConnectorException extends ConflictException {
  static readonly apiDescription =
    'The onboarding is parked on an asynchronous connector and accepts no client submit until ' +
    'its callback, or an operator reconcile, decides the step; `pendingConnector` names the ' +
    'connector. Poll the state rather than resubmitting: a resubmit would open a second ' +
    'provider attempt.';

  constructor(pendingConnector: ConnectorPendingExecution) {
    super({
      code: 'ONBOARDING_AWAITING_CONNECTOR',
      message: 'ONBOARDING_AWAITING_CONNECTOR',
      pendingConnector: {
        connectorId: pendingConnector.connectorId,
        connectorName: pendingConnector.connectorName,
        connectorOrder: pendingConnector.connectorOrder,
      },
    });
  }
}
