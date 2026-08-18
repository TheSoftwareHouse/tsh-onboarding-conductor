import { BadRequestException } from '@nestjs/common';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import { MockAsyncCallbackConnector } from '../connectors/adapters/sandbox/mock-async-callback.connector';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { WorkflowConnectorExecutorService } from '../connectors/workflow-connector-executor.service';
import { OnboardingsService } from '../onboardings/onboardings.service';
import { AuditService } from '../audit/audit.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

describe('WebhookController', () => {
  const manager = {};
  const dataSource = { manager } as unknown as DataSource;

  const webhookServiceMock = {
    process: jest.fn(),
  } as unknown as jest.Mocked<WebhookService>;

  const onboardingsServiceMock = {
    submit: jest.fn(),
  } as unknown as jest.Mocked<OnboardingsService>;

  const auditServiceMock = {
    logWebhook: jest.fn(),
  } as unknown as AuditService;

  const createController = () =>
    new WebhookController(dataSource, webhookServiceMock, onboardingsServiceMock, auditServiceMock);

  beforeEach(() => {
    jest.clearAllMocks();
    (auditServiceMock.logWebhook as jest.Mock).mockResolvedValue(undefined);
    webhookServiceMock.process.mockResolvedValue({
      onboardingId: 'onboarding-1',
      submittedData: { accepted: true },
      providerIdentity: 'mock_async_callback',
      resolvedConnector: { connectorOrder: 2, result: ConnectorExecutionResult.accepted() },
    });
    onboardingsServiceMock.submit.mockResolvedValue({
      appliedStep: 'accept_terms',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      rejectionReason: null,
    });
  });

  it('delegates provider-key ingress to processing and narrow onboarding continuation', async () => {
    const controller = createController();
    const rawPayload = Buffer.from([0, 159, 255, 10, 13, 0, 1, 2, 3]);

    await controller.receive('mock_async_callback', {
      body: rawPayload,
      headers: {
        'x-mock-callback-auth': 'metadata',
      },
    } as never);

    expect(webhookServiceMock.process).toHaveBeenCalledWith(manager, {
      providerKey: 'mock_async_callback',
      rawBody: expect.any(Uint8Array),
      headers: expect.objectContaining({ 'x-mock-callback-auth': 'metadata' }),
    });
    const [callArgs] = webhookServiceMock.process.mock.calls;
    expect(Buffer.from(callArgs[1].rawBody)).toEqual(rawPayload);
    expect(onboardingsServiceMock.submit).toHaveBeenCalledTimes(1);
    expect(onboardingsServiceMock.submit).toHaveBeenCalledWith(
      'onboarding-1',
      { accepted: true },
      {
        providerIdentity: 'mock_async_callback',
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

    expect(webhookServiceMock.process).not.toHaveBeenCalled();
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_rejected',
        resourceType: 'provider_callback',
        resourceId: 'unresolved',
        metadata: { reason: 'raw_body_required' },
      }),
    );

    const rejectedAuditInput = (auditServiceMock.logWebhook as jest.Mock).mock.calls[0][1] as {
      metadata: Record<string, unknown>;
    };
    expect(rejectedAuditInput.metadata).not.toHaveProperty('rawBody');
    expect(rejectedAuditInput.metadata).not.toHaveProperty('payload');
  });

  it('preserves callback processing when the receipt audit write fails', async () => {
    const controller = createController();
    (auditServiceMock.logWebhook as jest.Mock).mockRejectedValueOnce(new Error('audit failed'));

    await expect(
      controller.receive('mock_async_callback', {
        body: Buffer.from('valid-callback'),
        headers: { 'x-mock-callback-auth': 'metadata' },
      } as never),
    ).resolves.toBeUndefined();

    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_received',
        metadata: { ingress: 'provider_callback' },
      }),
    );
    const receivedAuditInput = (auditServiceMock.logWebhook as jest.Mock).mock.calls[0][1] as {
      metadata: Record<string, unknown>;
    };
    expect(receivedAuditInput.metadata).not.toHaveProperty('rawBody');
    expect(receivedAuditInput.metadata).not.toHaveProperty('payload');

    expect(webhookServiceMock.process).toHaveBeenCalledTimes(1);
    expect(onboardingsServiceMock.submit).toHaveBeenCalledTimes(1);
  });

  it('preserves provider-key rejection when the rejection audit write fails', async () => {
    const controller = createController();
    const invalidProviderKeyError = new BadRequestException({
      code: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
      message: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
    });

    webhookServiceMock.process.mockRejectedValueOnce(invalidProviderKeyError);
    (auditServiceMock.logWebhook as jest.Mock).mockRejectedValueOnce(new Error('audit failed'));

    await expect(
      controller.receive('MOCK-ASYNC-CALLBACK', {
        body: Buffer.from('valid-callback'),
        headers: {},
      } as never),
    ).rejects.toMatchObject({
      response: {
        code: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
      },
      status: 400,
    });

    expect(webhookServiceMock.process).toHaveBeenCalledTimes(1);
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('composes async initiation, provider callback mapping, and continuation submit using the existing callback path', async () => {
    const connector = new MockAsyncCallbackConnector();
    const executionPort = new WorkflowConnectorExecutorService([connector]);
    const service = new WebhookService(
      {} as never,
      {} as never,
      dataSource,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
      executionPort,
    );
    const submit = jest.fn().mockResolvedValue({
      appliedStep: 'accept_terms',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      rejectionReason: null,
    });
    const controller = new WebhookController(dataSource, service, {
      submit,
    } as unknown as OnboardingsService);

    const pending = await executionPort.execute(
      [
        {
          name: 'mock_async_callback_step',
          type: 'mock_async_callback',
          order: 1,
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
        providerIdentity: 'mock_async_callback',
        resolvedConnector: {
          connectorOrder: 1,
          result: ConnectorExecutionResult.accepted(),
        },
      },
    );
  });
});
