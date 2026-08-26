import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import { MockAsyncCallbackConnector } from './mock-async-callback.connector';

const encodeUtf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('MockAsyncCallbackConnector', () => {
  it('exposes explicit async callback capability', () => {
    const connector = new MockAsyncCallbackConnector();

    expect(connector.name).toBe('mock_async_callback');
    expect(connector.id).toBe('mock_async_callback');
    expect(connector.type).toBe('custom');
    expect(connector.supportsAsyncCallback).toBe(true);
  });

  it('creates and stores an opaque provider reference during initiation', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.execute({
        declaration: { order: 2, config: {} },
        execution: { onboardingId: 'onboarding-1', stepName: 'accept_terms' },
        context: { acceptedTerms: true },
        payload: {},
        payloadFieldSources: {},
      }),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());

    const initiation = connector.getLatestInitiation();
    expect(initiation).toEqual(
      expect.objectContaining({
        onboardingId: 'onboarding-1',
        connectorOrder: 2,
      }),
    );
    expect(initiation?.providerReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('emits callback payload without framework correlation fields', async () => {
    const connector = new MockAsyncCallbackConnector();
    await connector.execute({
      declaration: { order: 1, config: {} },
      execution: { onboardingId: 'onboarding-1', stepName: 'accept_terms' },
      context: {},
      payload: {},
      payloadFieldSources: {},
    });
    const initiation = connector.getLatestInitiation();

    const callback = connector.emitProviderCallback({
      providerReference: initiation!.providerReference,
      submittedData: { acceptedTerms: true },
    });
    const payload = JSON.parse(new TextDecoder().decode(callback.rawBody)) as Record<
      string,
      unknown
    >;

    expect(payload.providerReference).toBe(initiation!.providerReference);
    expect(payload.submittedData).toEqual({ acceptedTerms: true });
    expect(payload.onboardingId).toBeUndefined();
    expect(payload.connectorOrder).toBeUndefined();
  });

  it('maps accepted callback status using stored onboarding correlation', async () => {
    const connector = new MockAsyncCallbackConnector();
    await connector.execute({
      declaration: { order: 2, config: {} },
      execution: { onboardingId: 'onboarding-1', stepName: 'accept_terms' },
      context: {},
      payload: {},
      payloadFieldSources: {},
    });
    const initiation = connector.getLatestInitiation();
    const callback = connector.emitProviderCallback({
      providerReference: initiation!.providerReference,
      submittedData: { acceptedTerms: true },
      status: 'accepted',
    });

    await expect(
      connector.mapCallbackResult({
        headers: callback.headers,
        rawBody: callback.rawBody,
      }),
    ).resolves.toEqual({
      onboardingId: 'onboarding-1',
      submittedData: { acceptedTerms: true },
      resolvedConnector: { connectorOrder: 2 },
      result: ConnectorExecutionResult.accepted(),
    });
  });

  it('maps rejected, invalid, and invalid-data callback statuses', async () => {
    const connector = new MockAsyncCallbackConnector();
    await connector.execute({
      declaration: { order: 4, config: {} },
      execution: { onboardingId: 'onboarding-2', stepName: 'accept_terms' },
      context: {},
      payload: {},
      payloadFieldSources: {},
    });
    const initiation = connector.getLatestInitiation();

    const rejected = connector.emitProviderCallback({
      providerReference: initiation!.providerReference,
      submittedData: { acceptedTerms: true },
      status: 'rejected',
      reason: 'CONNECTOR_REJECTED',
    });
    const invalid = connector.emitProviderCallback({
      providerReference: initiation!.providerReference,
      submittedData: { acceptedTerms: true },
      status: 'invalid',
    });
    const invalidData = connector.emitProviderCallback({
      providerReference: initiation!.providerReference,
      submittedData: { acceptedTerms: true },
      status: 'invalid-data',
      errors: { verificationCode: ['INVALID'] },
    });

    await expect(
      connector.mapCallbackResult({ headers: {}, rawBody: rejected.rawBody }),
    ).resolves.toEqual(
      expect.objectContaining({
        result: ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'),
      }),
    );

    await expect(
      connector.mapCallbackResult({ headers: {}, rawBody: invalid.rawBody }),
    ).resolves.toEqual(
      expect.objectContaining({
        result: ConnectorExecutionResult.invalid(),
      }),
    );

    await expect(
      connector.mapCallbackResult({ headers: {}, rawBody: invalidData.rawBody }),
    ).resolves.toEqual(
      expect.objectContaining({
        result: ConnectorExecutionResult.invalidData({ verificationCode: ['INVALID'] }),
      }),
    );
  });

  it('rejects malformed callback payload input', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        headers: {},
        rawBody: encodeUtf8('not-json'),
      }),
    ).rejects.toThrow('Callback body must be valid JSON');
  });

  it('rejects callback payload with forbidden framework correlation fields', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        headers: {},
        rawBody: encodeUtf8(
          JSON.stringify({
            providerReference: 'provider-ref',
            onboardingId: 'onboarding-1',
            submittedData: { acceptedTerms: true },
          }),
        ),
      }),
    ).rejects.toThrow('Callback payload contains forbidden correlation fields');
  });

  it('rejects callback payload with non-object submitted data', async () => {
    const connector = new MockAsyncCallbackConnector();

    await expect(
      connector.mapCallbackResult({
        headers: {},
        rawBody: encodeUtf8(
          JSON.stringify({
            providerReference: 'provider-ref',
            submittedData: 'invalid',
          }),
        ),
      }),
    ).rejects.toThrow('submittedData must be an object');
  });

  it('rejects unknown provider references', async () => {
    const connector = new MockAsyncCallbackConnector();
    const callback = connector.emitProviderCallback({
      providerReference: 'unknown-reference',
      submittedData: { acceptedTerms: true },
    });

    await expect(
      connector.mapCallbackResult({ headers: callback.headers, rawBody: callback.rawBody }),
    ).rejects.toThrow('Unknown provider reference');
  });

  it('keeps mapping deterministic across repeated callbacks', async () => {
    const connector = new MockAsyncCallbackConnector();
    await connector.execute({
      declaration: { order: 1, config: {} },
      execution: { onboardingId: 'onboarding-1', stepName: 'accept_terms' },
      context: {},
      payload: {},
      payloadFieldSources: {},
    });
    const initiation = connector.getLatestInitiation();
    const callback = connector.emitProviderCallback({
      providerReference: initiation!.providerReference,
      submittedData: { acceptedTerms: true },
    });

    const first = await connector.mapCallbackResult({
      headers: {},
      rawBody: callback.rawBody,
    });

    const second = await connector.mapCallbackResult({
      headers: {},
      rawBody: callback.rawBody,
    });

    expect(first).toEqual(second);
    expect(first.result).toEqual(ConnectorExecutionResult.accepted());
  });
});
