import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import { ConnectorCallbackAlreadyAppliedError } from '../connectors/errors/connector-callback-already-applied.error';
import { ConnectorCallbackSupersededError } from '../connectors/errors/connector-callback-superseded.error';
import type { ConnectorExecutionPort } from '../connectors/ports/connector-execution.port';
import {
  ConnectorExecutionResult,
  type ConnectorPendingExecution,
} from '../connectors/ports/connector-execution-result';
import type { OnboardingsRepository } from './onboardings.repository';
import type { OnboardingsService } from './onboardings.service';
import { PendingConnectorReconcileService } from './pending-connector-reconcile.service';
import { createOnboarding, manager } from './testing/onboardings-service.harness';

const ONBOARDING_ID = '01912345-6789-7abc-8def-0123456789ab';
const OPERATOR_ID = 'operator-oid';
const PARK: ConnectorPendingExecution = {
  connectorName: 'kyc_step',
  connectorId: 'veriff_kyc',
  connectorOrder: 1,
  providerReference: 'session-1',
  parkedAt: '2026-10-08T10:00:00.000Z',
};
const SUMMARY = { onboardingId: ONBOARDING_ID, pendingConnector: null };

const createSut = (
  options: {
    onboarding?: ReturnType<typeof createOnboarding> | null;
    adapter?: Record<string, unknown>;
  } = {},
) => {
  const onboarding =
    options.onboarding === undefined
      ? createOnboarding({ id: ONBOARDING_ID, pendingConnector: PARK })
      : options.onboarding;
  const adapter = options.adapter ?? {
    id: 'veriff_kyc',
    reconcilePending: jest.fn().mockResolvedValue({ outcome: 'still_pending' }),
  };
  const repository = { findById: jest.fn().mockResolvedValue(onboarding) };
  const onboardingsService = {
    submit: jest.fn().mockResolvedValue(undefined),
    getForAdmin: jest.fn().mockResolvedValue(SUMMARY),
  };
  const auditService = { logPendingConnectorReconcile: jest.fn().mockResolvedValue(undefined) };
  const port = { findAdapterById: jest.fn().mockReturnValue(adapter) };
  const sut = new PendingConnectorReconcileService(
    { manager } as unknown as DataSource,
    repository as unknown as OnboardingsRepository,
    onboardingsService as unknown as OnboardingsService,
    auditService as unknown as AuditService,
    port as unknown as ConnectorExecutionPort,
  );

  return { sut, adapter, repository, onboardingsService, auditService, port };
};

describe('PendingConnectorReconcileService', () => {
  it('refuses an unknown onboarding', async () => {
    const { sut } = createSut({ onboarding: null });

    await expect(sut.reconcile(ONBOARDING_ID, OPERATOR_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses an onboarding that is not parked', async () => {
    const { sut, port } = createSut({ onboarding: createOnboarding({ id: ONBOARDING_ID }) });

    const error: unknown = await sut
      .reconcile(ONBOARDING_ID, OPERATOR_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'ONBOARDING_NOT_AWAITING_CONNECTOR',
    });
    expect(port.findAdapterById).not.toHaveBeenCalled();
  });

  it('refuses a parked connector whose adapter offers no read-back', async () => {
    const { sut } = createSut({ adapter: { id: 'veriff_kyc' } });

    const error: unknown = await sut
      .reconcile(ONBOARDING_ID, OPERATOR_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'PENDING_CONNECTOR_RECONCILE_UNSUPPORTED',
      message: 'PENDING_CONNECTOR_RECONCILE_UNSUPPORTED',
      connectorId: 'veriff_kyc',
      reason: 'adapter',
    });
  });

  it('answers still_pending with an observed audit row and no submit when the provider has not decided', async () => {
    const { sut, adapter, onboardingsService, auditService } = createSut();

    await expect(sut.reconcile(ONBOARDING_ID, OPERATOR_ID)).resolves.toEqual({
      outcome: 'still_pending',
      onboarding: SUMMARY,
    });

    expect(adapter.reconcilePending).toHaveBeenCalledWith({ onboardingId: ONBOARDING_ID });
    expect(onboardingsService.submit).not.toHaveBeenCalled();
    expect(auditService.logPendingConnectorReconcile).toHaveBeenCalledWith(manager, {
      action: 'onboarding.pending_connector_reconcile_noop',
      actorId: OPERATOR_ID,
      resourceId: ONBOARDING_ID,
      metadata: { connectorId: 'veriff_kyc', connectorOrder: 1, outcome: 'still_pending' },
    });
  });

  it('applies a resolved verdict through the submit path as an operator reconcile', async () => {
    const result = ConnectorExecutionResult.accepted();
    const callback = {
      onboardingId: ONBOARDING_ID,
      submittedData: { kycOutcome: 'verified' },
      resolvedConnector: { connectorOrder: 1, pendingConnector: PARK },
      result,
    };
    const { sut, onboardingsService, auditService } = createSut({
      adapter: {
        id: 'veriff_kyc',
        reconcilePending: jest.fn().mockResolvedValue({ outcome: 'resolved', callback }),
      },
    });

    await expect(sut.reconcile(ONBOARDING_ID, OPERATOR_ID)).resolves.toEqual({
      outcome: 'applied',
      onboarding: SUMMARY,
    });

    expect(onboardingsService.submit).toHaveBeenCalledWith(
      ONBOARDING_ID,
      { kycOutcome: 'verified' },
      {
        providerIdentity: 'veriff_kyc',
        origin: 'admin_reconcile',
        operatorId: OPERATOR_ID,
        resolvedConnector: { connectorOrder: 1, result, pendingConnector: PARK },
      },
    );
    // The applied row is the submit path's to write, inside its transaction.
    expect(auditService.logPendingConnectorReconcile).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the adapter finds the onboarding no longer parked',
      () => ({
        id: 'veriff_kyc',
        reconcilePending: jest
          .fn()
          .mockRejectedValue(new ConnectorCallbackAlreadyAppliedError(ONBOARDING_ID, 'veriff_kyc')),
      }),
      (onboardingsService: { submit: jest.Mock }) => onboardingsService,
    ],
    [
      'the locked row has left the park by the time the verdict is applied',
      () => ({
        id: 'veriff_kyc',
        reconcilePending: jest.fn().mockResolvedValue({
          outcome: 'resolved',
          callback: {
            onboardingId: ONBOARDING_ID,
            submittedData: {},
            resolvedConnector: { connectorOrder: 1, pendingConnector: PARK },
            result: ConnectorExecutionResult.accepted(),
          },
        }),
      }),
      (onboardingsService: { submit: jest.Mock }) => {
        onboardingsService.submit.mockRejectedValue(
          new ConnectorCallbackSupersededError(ONBOARDING_ID, 'veriff_kyc'),
        );
        return onboardingsService;
      },
    ],
  ])('answers superseded when %s', async (_, adapter, arrange) => {
    const { sut, onboardingsService, auditService } = createSut({ adapter: adapter() });
    arrange(onboardingsService);

    await expect(sut.reconcile(ONBOARDING_ID, OPERATOR_ID)).resolves.toEqual({
      outcome: 'superseded',
      onboarding: SUMMARY,
    });
    expect(auditService.logPendingConnectorReconcile).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'onboarding.pending_connector_reconcile_noop',
        metadata: expect.objectContaining({ outcome: 'superseded' }),
      }),
    );
  });

  it('lets a provider failure propagate', async () => {
    const failure = new Error('VERIFF_UNAVAILABLE');
    const { sut } = createSut({
      adapter: { id: 'veriff_kyc', reconcilePending: jest.fn().mockRejectedValue(failure) },
    });

    await expect(sut.reconcile(ONBOARDING_ID, OPERATOR_ID)).rejects.toBe(failure);
  });
});
