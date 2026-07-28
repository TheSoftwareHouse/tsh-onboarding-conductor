import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
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
});
