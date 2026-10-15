import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { PendingConnectorReconcileNoopOutcome } from '../audit/audit.types';
import { redactAuditFields } from '../connectors/ports/audit-redaction';
import { ConnectorCallbackAlreadyAppliedError } from '../connectors/errors/connector-callback-already-applied.error';
import { ConnectorCallbackSupersededError } from '../connectors/errors/connector-callback-superseded.error';
import { PendingConnectorReconcileUnsupportedException } from '../connectors/errors/pending-connector-reconcile-unsupported.exception';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import type { ConnectorPendingExecution } from '../connectors/ports/connector-execution-result';
import { ReconcilePendingConnectorResponseDto } from './dto/reconcile-pending-connector.response.dto';
import { OnboardingNotAwaitingConnectorException } from './errors/onboarding-not-awaiting-connector.exception';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

/**
 * An operator's answer to a callback that never came: ask the parked connector's adapter for the
 * verdict the provider holds and apply it through the same submit path a callback takes, so the
 * lock, the park re-check and the state transition are the ones a callback would have had.
 * Nothing here is scheduled — the route is the manual form of the reconciliation a poller would
 * run.
 */
@Injectable()
export class PendingConnectorReconcileService {
  private readonly logger = new Logger(PendingConnectorReconcileService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly onboardingsService: OnboardingsService,
    private readonly auditService: AuditService,
    @Inject(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)
    private readonly connectorExecutionPort: ConnectorExecutionPort,
  ) {}

  async reconcile(
    onboardingId: string,
    operatorId: string,
  ): Promise<ReconcilePendingConnectorResponseDto> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      throw new OnboardingNotFoundException();
    }

    const park = onboarding.pendingConnector;

    if (park === null) {
      throw new OnboardingNotAwaitingConnectorException();
    }

    const adapter = this.connectorExecutionPort.findAdapterById?.(park.connectorId);

    if (adapter?.reconcilePending === undefined) {
      throw new PendingConnectorReconcileUnsupportedException(park.connectorId, 'adapter');
    }

    const reconciled = await adapter.reconcilePending({ onboardingId }).catch((error: unknown) => {
      // The adapter's own correlation found no park: the onboarding moved on between the read
      // above and the adapter's, which is the same answer as a superseded apply.
      if (error instanceof ConnectorCallbackAlreadyAppliedError) {
        return undefined;
      }

      throw error;
    });

    if (reconciled === undefined) {
      return this.answerNoop(onboardingId, operatorId, park, 'superseded');
    }

    if (reconciled.outcome === 'still_pending') {
      return this.answerNoop(onboardingId, operatorId, park, 'still_pending');
    }

    const { callback } = reconciled;

    try {
      await this.onboardingsService.submit(onboardingId, callback.submittedData, {
        providerIdentity: adapter.id,
        auditSubmittedData: redactAuditFields(callback.submittedData, adapter.auditRedactedFields),
        origin: 'admin_reconcile',
        operatorId,
        resolvedConnector: {
          connectorOrder: callback.resolvedConnector.connectorOrder,
          result: callback.result,
          pendingConnector: callback.resolvedConnector.pendingConnector,
        },
      });
    } catch (error) {
      if (error instanceof ConnectorCallbackSupersededError) {
        return this.answerNoop(onboardingId, operatorId, park, 'superseded');
      }

      throw error;
    }

    this.logger.log(
      `PENDING_CONNECTOR_RECONCILED onboardingId=${onboardingId} connectorId=${park.connectorId}`,
    );

    return {
      outcome: 'applied',
      onboarding: await this.onboardingsService.getForAdmin(onboardingId),
    };
  }

  private async answerNoop(
    onboardingId: string,
    operatorId: string,
    park: ConnectorPendingExecution,
    outcome: PendingConnectorReconcileNoopOutcome,
  ): Promise<ReconcilePendingConnectorResponseDto> {
    await this.auditService.logPendingConnectorReconcile(this.dataSource.manager, {
      action: 'onboarding.pending_connector_reconcile_noop',
      actorId: operatorId,
      resourceId: onboardingId,
      metadata: { connectorId: park.connectorId, connectorOrder: park.connectorOrder, outcome },
    });

    return { outcome, onboarding: await this.onboardingsService.getForAdmin(onboardingId) };
  }
}
