import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_CONNECTOR_RETRY,
  type NormalizedWorkflowConnectorDeclaration,
} from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import { AppConfig } from '../config/app.config';
import { MockAsyncCallbackConnector } from '../connectors/adapters/fixtures/mock-async-callback.connector';
import { FallbackOnErrorHandler } from '../connectors/error-handlers/built-in/fallback-on-error.handler';
import { redactAuditFields } from '../connectors/ports/audit-redaction';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { WorkflowConnectorExecutorService } from '../connectors/workflow-connector-executor.service';
import { OnboardingsService } from '../onboardings/onboardings.service';
import { AuditService } from '../audit/audit.service';
import { isAuditRecorded } from '../audit/audit-recorded.marker';
import { ConnectorSettingsService } from '../connectors/connector-settings.service';
import {
  CALLBACK_SIGNING_SECRET_KEY,
  CallbackSignatureVerifier,
} from './callback-signature/callback-signature.verifier';
import { ConnectorCallbackAlreadyAppliedError } from '../connectors/errors/connector-callback-already-applied.error';
import { ConnectorCallbackPayloadInvalidError } from '../connectors/errors/connector-callback-payload-invalid.error';
import { ConnectorCallbackSupersededError } from '../connectors/errors/connector-callback-superseded.error';
import { ConnectorCallbackUnresolvedError } from '../connectors/errors/connector-callback-unresolved.error';
import { AsyncCallbackPayloadInvalidException } from './errors/async-callback-payload-invalid.exception';
import { CallbackSignatureInvalidException } from './errors/callback-signature-invalid.exception';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

/** Stands in for the `connectors` row that stores each adapter's `callbackSigningSecret`. */
const createConnectorSettingsService = (
  callbackSecrets: Record<string, string | readonly string[]>,
) =>
  ({
    resolve: jest.fn().mockImplementation(async (adapter: { id: string }) => {
      const stored = callbackSecrets[adapter.id];

      return {
        find: (key: string) =>
          key === CALLBACK_SIGNING_SECRET_KEY
            ? Array.isArray(stored)
              ? stored.join(',')
              : (stored as string | undefined)
            : undefined,
        get: () => {
          throw new Error('unused');
        },
      };
    }),
  }) as unknown as ConnectorSettingsService;

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

  const createCallbackSignatureVerifier = () =>
    new CallbackSignatureVerifier(
      {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'CONNECTOR_CALLBACK_UNSIGNED_TYPES') {
            return '';
          }

          if (key === 'NODE_ENV') {
            return 'test';
          }

          throw new Error(`Unexpected config key: ${key}`);
        }),
      } as unknown as ConfigService<AppConfig, true>,
      createConnectorSettingsService({}),
    );

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
        origin: 'provider_callback',
        resolvedConnector: {
          connectorOrder: 2,
          result: ConnectorExecutionResult.accepted(),
        },
      },
    );
  });

  it('hands the audit the adapter-redacted submitted data: the report size, never the report', async () => {
    const controller = createController();
    const report = { scores: [640], transactions: [{ amount: 1 }] };
    webhookServiceMock.process.mockResolvedValue({
      onboardingId: 'onboarding-1',
      submittedData: { creditOutcome: 'approved', creditReport: report },
      auditSubmittedData: redactAuditFields({ creditOutcome: 'approved', creditReport: report }, [
        'creditReport',
      ]),
      providerIdentity: 'credit',
      resolvedConnector: { connectorOrder: 1, result: ConnectorExecutionResult.accepted() },
    });

    await controller.receive('credit', { body: Buffer.from('{}'), headers: {} } as never);

    const [, submitted, continuation] = onboardingsServiceMock.submit.mock.calls[0];
    expect(submitted).toEqual({ creditOutcome: 'approved', creditReport: report });
    expect(continuation?.auditSubmittedData).toEqual({
      creditOutcome: 'approved',
      creditReportBytes: Buffer.byteLength(JSON.stringify(report)),
    });
    expect(continuation?.auditSubmittedData).not.toHaveProperty('creditReport');
  });

  it('throws BadRequestException when raw callback body is not binary', async () => {
    const controller = createController();

    const error: unknown = await controller
      .receive('mock_async_callback', {
        body: { eventId: 'evt-1' },
        headers: {},
      } as never)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(isAuditRecorded(error)).toBe(true);

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
    // The first call records `webhook.inbound_callback_received` and must succeed so only the
    // rejection write itself is the one that fails.
    (auditServiceMock.logWebhook as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('audit failed'));

    const error: unknown = await controller
      .receive('MOCK-ASYNC-CALLBACK', {
        body: Buffer.from('valid-callback'),
        headers: {},
      } as never)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      response: {
        code: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
      },
      status: 400,
    });
    // No domain row was actually written, so the filter must still catch this one.
    expect(isAuditRecorded(error)).toBe(false);

    expect(webhookServiceMock.process).toHaveBeenCalledTimes(1);
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('records a signature rejection reason and keeps the opaque 401 for the caller', async () => {
    const controller = createController();

    webhookServiceMock.process.mockRejectedValueOnce(
      new CallbackSignatureInvalidException('signature_mismatch'),
    );

    const error: unknown = await controller
      .receive('acme_kyc', {
        body: Buffer.from('valid-callback'),
        headers: { 'x-acme-signature': 'deadbeef' },
      } as never)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      response: {
        code: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
      },
      status: 401,
    });
    expect(isAuditRecorded(error)).toBe(true);

    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_rejected',
        resourceType: 'provider_callback',
        resourceId: 'unresolved',
        metadata: { reason: 'signature_mismatch' },
      }),
    );
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('records a signature rejection reason and answers 503 for a configuration gap, not 401', async () => {
    const controller = createController();

    webhookServiceMock.process.mockRejectedValueOnce(
      new CallbackSignatureInvalidException('signing_secret_missing'),
    );

    await expect(
      controller.receive('acme_kyc', {
        body: Buffer.from('valid-callback'),
        headers: { 'x-acme-signature': 'deadbeef' },
      } as never),
    ).rejects.toMatchObject({
      response: {
        code: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
      },
      status: 503,
    });

    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_rejected',
        resourceType: 'provider_callback',
        resourceId: 'unresolved',
        metadata: { reason: 'signing_secret_missing' },
      }),
    );
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('acknowledges a stale callback whose connector already advanced instead of erroring', async () => {
    const controller = createController();

    webhookServiceMock.process.mockRejectedValueOnce(
      new ConnectorCallbackAlreadyAppliedError('onboarding-1', 'sumsub_kyc'),
    );

    await expect(
      controller.receive('sumsub_kyc', {
        body: Buffer.from('valid-callback'),
        headers: { 'x-payload-digest': 'deadbeef' },
      } as never),
    ).resolves.toBeUndefined();

    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_rejected',
        resourceType: 'provider_callback',
        resourceId: 'unresolved',
        metadata: { reason: 'callback_already_applied' },
      }),
    );
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('acknowledges a callback naming a provider resource that resolves to no onboarding with 204 and an unresolved reason', async () => {
    const controller = createController();

    webhookServiceMock.process.mockRejectedValueOnce(
      new ConnectorCallbackUnresolvedError('algoan_credit', 'no such customer'),
    );

    await expect(
      controller.receive('algoan_credit', {
        body: Buffer.from('valid-callback'),
        headers: { 'x-hub-signature': 'sha256=deadbeef' },
      } as never),
    ).resolves.toBeUndefined();

    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_rejected',
        resourceType: 'provider_callback',
        resourceId: 'unresolved',
        metadata: { reason: 'callback_unresolved' },
      }),
    );
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('answers 400 CALLBACK_PAYLOAD_INVALID with a payload_invalid reason for a callback the adapter cannot read', async () => {
    const controller = createController();

    webhookServiceMock.process.mockRejectedValueOnce(
      new ConnectorCallbackPayloadInvalidError('algoan_credit', 'not JSON'),
    );

    const error: unknown = await controller
      .receive('algoan_credit', {
        body: Buffer.from('nope'),
        headers: { 'x-hub-signature': 'sha256=deadbeef' },
      } as never)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AsyncCallbackPayloadInvalidException);
    expect((error as AsyncCallbackPayloadInvalidException).getResponse()).toEqual({
      code: 'CALLBACK_PAYLOAD_INVALID',
      message: 'CALLBACK_PAYLOAD_INVALID',
    });
    expect(isAuditRecorded(error)).toBe(true);
    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_rejected',
        metadata: { reason: 'payload_invalid' },
      }),
    );
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('acknowledges a callback the locked row no longer waits on with 204 and a superseded reason', async () => {
    const controller = createController();

    onboardingsServiceMock.submit.mockRejectedValueOnce(
      new ConnectorCallbackSupersededError('onboarding-1', 'mock_async_callback'),
    );

    await expect(
      controller.receive('mock_async_callback', {
        body: Buffer.from('valid-callback'),
        headers: { 'x-mock-callback-auth': 'metadata' },
      } as never),
    ).resolves.toBeUndefined();

    expect(auditServiceMock.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.inbound_callback_rejected',
        resourceType: 'provider_callback',
        resourceId: 'unresolved',
        metadata: { reason: 'callback_superseded' },
      }),
    );
    expect(onboardingsServiceMock.submit).toHaveBeenCalledTimes(1);
  });

  it('does not mark or audit-reject an unrecognized processing failure', async () => {
    const controller = createController();
    const unmappedError = new Error('unexpected mapping failure');

    webhookServiceMock.process.mockRejectedValueOnce(unmappedError);

    const error: unknown = await controller
      .receive('mock_async_callback', {
        body: Buffer.from('valid-callback'),
        headers: {},
      } as never)
      .catch((caught: unknown) => caught);

    expect(error).toBe(unmappedError);
    expect(isAuditRecorded(error)).toBe(false);
    expect(auditServiceMock.logWebhook).not.toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ action: 'webhook.inbound_callback_rejected' }),
    );
    expect(onboardingsServiceMock.submit).not.toHaveBeenCalled();
  });

  it('composes async initiation, provider callback mapping, and continuation submit using the existing callback path', async () => {
    const connector = new MockAsyncCallbackConnector();
    const executionPort = new WorkflowConnectorExecutorService(
      [connector],
      [new FallbackOnErrorHandler()],
      auditServiceMock,
      dataSource,
    );
    const service = new WebhookService(
      {} as never,
      {} as never,
      dataSource,
      { getOrThrow: jest.fn().mockReturnValue(5000) } as never,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
      createCallbackSignatureVerifier(),
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
          id: 'mock_async_callback',
          type: 'custom',
          order: 1,
          async: true,
          canReject: false,
          config: {},
          fieldMapping: {},
          optionalFieldMapping: {},
          retry: DEFAULT_CONNECTOR_RETRY,
          fallbacks: [],
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
        connectorId: 'mock_async_callback',
        connectorOrder: 1,
        providerReference: expect.any(String),
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
        auditSubmittedData: { kycStatus: 'approved' },
        origin: 'provider_callback',
        resolvedConnector: {
          connectorOrder: 1,
          result: ConnectorExecutionResult.accepted(),
          pendingConnector: expect.objectContaining({
            connectorId: 'mock_async_callback',
            connectorOrder: 1,
            providerReference: initiation!.providerReference,
          }),
        },
      },
    );
  });
});
