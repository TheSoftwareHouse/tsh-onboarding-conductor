import { BadRequestException } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import { MockAsyncCallbackConnector } from '../connectors/adapters/mock-async-callback.connector';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { WorkflowConnectorExecutorService } from '../connectors/workflow-connector-executor.service';
import { OnboardingsService } from '../onboardings/onboardings.service';
import { AsyncConnectorCallbacksController } from './async-connector-callbacks.controller';
import { AsyncConnectorCallbacksService } from './async-connector-callbacks.service';

describe('AsyncConnectorCallbacksController', () => {
  const manager = {};
  const dataSource = { manager } as unknown as DataSource;

  const asyncCallbacksServiceMock = {
    normalizeInboundCallback: jest.fn(),
  } as unknown as jest.Mocked<AsyncConnectorCallbacksService>;

  const onboardingsServiceMock = {
    submit: jest.fn(),
  } as unknown as jest.Mocked<OnboardingsService>;

  const createController = () =>
    new AsyncConnectorCallbacksController(
      dataSource,
      asyncCallbacksServiceMock,
      onboardingsServiceMock,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    asyncCallbacksServiceMock.normalizeInboundCallback.mockResolvedValue({
      onboardingId: 'onboarding-1',
      submittedData: { accepted: true },
      resolvedConnector: { connectorOrder: 2, result: ConnectorExecutionResult.accepted() },
    });
    onboardingsServiceMock.submit.mockResolvedValue({
      appliedStep: 'accept_terms',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      rejectionReason: null,
    });
  });

  it('delegates provider-key ingress to normalization and narrow onboarding continuation', async () => {
    const controller = createController();
    const rawPayload = Buffer.from([0, 159, 255, 10, 13, 0, 1, 2, 3]);

    await controller.receive('mock_async_callback', {
      body: rawPayload,
      headers: {
        'x-mock-callback-auth': 'metadata',
      },
    } as never);

    expect(asyncCallbacksServiceMock.normalizeInboundCallback).toHaveBeenCalledWith(manager, {
      providerKey: 'mock_async_callback',
      rawBody: expect.any(Uint8Array),
      headers: expect.objectContaining({ 'x-mock-callback-auth': 'metadata' }),
    });
    const [callArgs] = asyncCallbacksServiceMock.normalizeInboundCallback.mock.calls;
    expect(Buffer.from(callArgs[1].rawBody)).toEqual(rawPayload);
    expect(onboardingsServiceMock.submit).toHaveBeenCalledTimes(1);
    expect(onboardingsServiceMock.submit).toHaveBeenCalledWith(
      'onboarding-1',
      { accepted: true },
      {
        resolvedConnector: {
          connectorOrder: 2,
          result: ConnectorExecutionResult.accepted(),
        },
      },
    );
  });

  it('throws BadRequestException when raw callback body is not binary', async () => {
    const controller = createController();

    await expect(
      controller.receive('mock_async_callback', {
        body: { eventId: 'evt-1' },
        headers: {},
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(asyncCallbacksServiceMock.normalizeInboundCallback).not.toHaveBeenCalled();
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('composes async initiation, provider callback mapping, and continuation submit using the existing callback path', async () => {
    const connector = new MockAsyncCallbackConnector();
    const executionPort = new WorkflowConnectorExecutorService([connector]);
    const service = new AsyncConnectorCallbacksService(executionPort);
    const submit = jest.fn().mockResolvedValue({
      appliedStep: 'accept_terms',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      rejectionReason: null,
    });
    const controller = new AsyncConnectorCallbacksController(dataSource, service, {
      submit,
    } as unknown as OnboardingsService);

    const pending = await executionPort.execute(
      [
        {
          name: 'mock_async_callback_step',
          type: 'mock_async_callback',
          order: 1,
          method: 'verify',
          async: true,
          canReject: false,
          config: {},
          fieldMapping: {},
        } as NormalizedWorkflowConnectorDeclaration,
      ],
      {},
      {
        onboardingId: 'onboarding-42',
        stepName: 'collect_identity',
      },
    );

    expect(pending).toEqual(
      ConnectorExecutionResult.pending({
        connectorName: 'mock_async_callback_step',
        connectorType: 'mock_async_callback',
        connectorOrder: 1,
      }),
    );

    const initiation = connector.getLatestInitiation();
    expect(initiation).toEqual(
      expect.objectContaining({ onboardingId: 'onboarding-42', connectorOrder: 1 }),
    );

    const callback = connector.emitProviderCallback({
      providerReference: initiation!.providerReference,
      status: 'accepted',
      submittedData: { kycStatus: 'approved' },
    });

    await controller.receive('mock_async_callback', {
      body: Buffer.from(callback.rawBody),
      headers: callback.headers,
    } as never);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      'onboarding-42',
      { kycStatus: 'approved' },
      {
        resolvedConnector: {
          connectorOrder: 1,
          result: ConnectorExecutionResult.accepted(),
        },
      },
    );
  });
});
