import { ConnectorExecutionResult } from '../ports/connector-execution-result';
import { MockAsyncCallbackConnector } from './mock-async-callback.connector';

const encodeUtf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const createPayload = (input: {
  onboardingId: string;
  connectorOrder: number;
  submittedData?: Record<string, unknown>;
}): Uint8Array =>
  encodeUtf8(
    JSON.stringify({
      onboardingId: input.onboardingId,
      connectorOrder: input.connectorOrder,
      submittedData: input.submittedData ?? { acceptedTerms: true },
    }),
  );

describe('MockAsyncCallbackConnector', () => {
  it('exposes explicit async callback capability', () => {
    const connector = new MockAsyncCallbackConnector();

    expect(connector.name).toBe('mock_async_callback');
    expect(connector.type).toBe('mock_async_callback');
    expect(connector.supportsAsyncCallback).toBe(true);
  });

  it('maps a valid callback payload to onboarding submission triplet with accepted result', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        providerKey: 'mock_async_callback',
        connectorType: 'mock_async_callback',
        headers: {},
        rawBody: createPayload({
          onboardingId: 'onboarding-1',
          connectorOrder: 2,
          submittedData: { acceptedTerms: true },
        }),
      }),
    ).resolves.toEqual({
      onboardingId: 'onboarding-1',
      submittedData: { acceptedTerms: true },
      resolvedConnector: { connectorOrder: 2 },
      result: ConnectorExecutionResult.accepted(),
    });
  });

  it('rejects callback mapping for invalid connector type', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        providerKey: 'mock_async_callback',
        connectorType: 'different_provider',
        headers: {},
        rawBody: createPayload({
          onboardingId: 'onboarding-1',
          connectorOrder: 1,
        }),
      }),
    ).rejects.toThrow('Unsupported connector type=different_provider');
  });

  it('rejects callback mapping for invalid provider key', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        providerKey: 'other_provider',
        connectorType: 'mock_async_callback',
        headers: {},
        rawBody: createPayload({
          onboardingId: 'onboarding-1',
          connectorOrder: 1,
        }),
      }),
    ).rejects.toThrow('Unsupported provider key=other_provider');
  });

  it('rejects malformed callback payload input', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        providerKey: 'mock_async_callback',
        connectorType: 'mock_async_callback',
        headers: {},
        rawBody: encodeUtf8('not-json'),
      }),
    ).rejects.toThrow('Callback body must be valid JSON');
  });

  it('rejects callback payload without onboarding id', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        providerKey: 'mock_async_callback',
        connectorType: 'mock_async_callback',
        headers: {},
        rawBody: encodeUtf8(
          JSON.stringify({
            connectorOrder: 1,
            submittedData: { acceptedTerms: true },
          }),
        ),
      }),
    ).rejects.toThrow('onboardingId must be a non-empty string');
  });

  it('rejects callback payload with malformed connector order', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        providerKey: 'mock_async_callback',
        connectorType: 'mock_async_callback',
        headers: {},
        rawBody: encodeUtf8(
          JSON.stringify({
            onboardingId: 'onboarding-1',
            connectorOrder: 0,
            submittedData: { acceptedTerms: true },
          }),
        ),
      }),
    ).rejects.toThrow('connectorOrder must be a positive integer');
  });

  it('keeps mapping deterministic across repeated callbacks', async () => {
    const connector = new MockAsyncCallbackConnector();

    const first = await connector.mapCallbackResult({
      providerKey: 'mock_async_callback',
      connectorType: 'mock_async_callback',
      headers: {},
      rawBody: createPayload({
        onboardingId: 'onboarding-1',
        connectorOrder: 1,
        submittedData: { acceptedTerms: true },
      }),
    });

    const second = await connector.mapCallbackResult({
      providerKey: 'mock_async_callback',
      connectorType: 'mock_async_callback',
      headers: {},
      rawBody: createPayload({
        onboardingId: 'onboarding-1',
        connectorOrder: 1,
        submittedData: { acceptedTerms: true },
      }),
    });

    expect(first).toEqual(second);
    expect(first.result).toEqual(ConnectorExecutionResult.accepted());
  });

  it('maps a rejected status and reason into the callback result', async () => {
    const connector = new MockAsyncCallbackConnector();

    const result = await connector.mapCallbackResult({
      providerKey: 'mock_async_callback',
      connectorType: 'mock_async_callback',
      headers: {},
      rawBody: encodeUtf8(
        JSON.stringify({
          onboardingId: 'onboarding-1',
          connectorOrder: 1,
          submittedData: { acceptedTerms: true },
          status: 'rejected',
          reason: 'CONNECTOR_REJECTED',
        }),
      ),
    });

    expect(result.result).toEqual(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'));
  });

  it('rejects callback payload with non-object submitted data', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        providerKey: 'mock_async_callback',
        connectorType: 'mock_async_callback',
        headers: {},
        rawBody: encodeUtf8(
          JSON.stringify({
            onboardingId: 'onboarding-1',
            connectorOrder: 1,
            submittedData: 'invalid',
          }),
        ),
      }),
    ).rejects.toThrow('submittedData must be an object');
  });
});
