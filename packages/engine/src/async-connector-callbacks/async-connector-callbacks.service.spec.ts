import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { ConnectorExecutionPort } from '../connectors/ports/connector-execution.port';
import { AsyncConnectorCallbacksService } from './async-connector-callbacks.service';

const createHarness = (connectorExecutionPort?: jest.Mocked<ConnectorExecutionPort>) => ({
  sut: new AsyncConnectorCallbacksService(connectorExecutionPort),
  connectorExecutionPort,
});

describe('AsyncConnectorCallbacksService', () => {
  it('delegates validation and mapping to the resolved adapter and returns the normalized triplet', async () => {
    const connectorExecutionPort = {
      execute: jest.fn(),
      continueAfter: jest.fn(),
      resolveAsyncCallbackAdapterByType: jest.fn(),
    } as unknown as jest.Mocked<ConnectorExecutionPort>;
    const harness = createHarness(connectorExecutionPort);
    const manager = {} as EntityManager;
    const mapCallbackResult = jest.fn().mockResolvedValue({
      onboardingId: 'onboarding-1',
      submittedData: { acceptedTerms: true },
      resolvedConnector: { connectorOrder: 2 },
    });

    connectorExecutionPort.resolveAsyncCallbackAdapterByType.mockReturnValue({
      name: 'mock_async_callback',
      type: 'mock_async_callback',
      supportsAsyncCallback: true,
      execute: jest.fn(),
      mapCallbackResult,
    });

    await expect(
      harness.sut.normalizeInboundCallback(manager, {
        providerKey: 'mock_async_callback',
        rawBody: new Uint8Array([1, 2, 3]),
        headers: { 'X-Test': 'value' },
      }),
    ).resolves.toEqual({
      onboardingId: 'onboarding-1',
      submittedData: { acceptedTerms: true },
      resolvedConnector: { connectorOrder: 2 },
    });

    expect(mapCallbackResult).toHaveBeenCalledWith({
      providerKey: 'mock_async_callback',
      connectorType: 'mock_async_callback',
      rawBody: expect.any(Uint8Array),
      headers: { 'x-test': 'value' },
    });
  });

  it('rejects malformed provider keys before adapter resolution', async () => {
    const connectorExecutionPort = {
      execute: jest.fn(),
      continueAfter: jest.fn(),
      resolveAsyncCallbackAdapterByType: jest.fn(),
    } as unknown as jest.Mocked<ConnectorExecutionPort>;
    const harness = createHarness(connectorExecutionPort);

    await expect(
      harness.sut.normalizeInboundCallback({} as EntityManager, {
        providerKey: 'MOCK-ASYNC-CALLBACK',
        rawBody: new Uint8Array([1]),
        headers: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(connectorExecutionPort.resolveAsyncCallbackAdapterByType).not.toHaveBeenCalled();
  });

  it('fails closed when callback adapter resolution fails', async () => {
    const connectorExecutionPort = {
      execute: jest.fn(),
      continueAfter: jest.fn(),
      resolveAsyncCallbackAdapterByType: jest.fn().mockImplementation(() => {
        throw new Error('missing adapter');
      }),
    } as unknown as jest.Mocked<ConnectorExecutionPort>;
    const harness = createHarness(connectorExecutionPort);

    await expect(
      harness.sut.normalizeInboundCallback({} as EntityManager, {
        providerKey: 'mock_async_callback',
        rawBody: new Uint8Array([1]),
        headers: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
