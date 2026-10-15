import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineClient } from './engine.client';
import { EngineError } from './engine-error';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('EngineClient', () => {
  const config = {
    get: (key: string) =>
      ({ ENGINE_BASE_URL: 'http://engine:3000/', ENGINE_REQUEST_TIMEOUT_MS: 60000 })[key],
  } as unknown as ConfigService<AppConfig, true>;
  let client: EngineClient;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    client = new EngineClient(config);
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  function lastCall() {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
  }

  it('starts an onboarding with only the workflow id', async () => {
    fetchMock.mockResolvedValue(
      json(201, { onboardingId: 'o1', status: 'awaiting_user', currentStep: 's', expiresAt: null }),
    );

    await expect(client.startOnboarding('wf')).resolves.toMatchObject({ onboardingId: 'o1' });

    const { url, init, body } = lastCall();
    expect(url).toBe('http://engine:3000/v1/onboardings');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ workflowId: 'wf' });
  });

  it('reads state with GET and no body', async () => {
    fetchMock.mockResolvedValue(json(200, { onboardingId: 'o1', pending: null, data: {} }));

    await client.getState('o1');

    const { url, init } = lastCall();
    expect(url).toBe('http://engine:3000/v1/onboardings/o1/state');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('submits the step values as the body', async () => {
    fetchMock.mockResolvedValue(
      json(201, {
        appliedStep: 'a',
        status: 'awaiting_user',
        currentStep: 'b',
        rejectionReason: null,
      }),
    );

    await client.submit('o1', { bankData: 'doc-1' });

    const { url, body } = lastCall();
    expect(url).toBe('http://engine:3000/v1/onboardings/o1/submit');
    expect(body).toEqual({ bankData: 'doc-1' });
  });

  it('reserves and completes a document', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(201, {
          documentId: 'd1',
          upload: { kind: 'post-form', url: 'u', fields: {} },
          expiresAt: 'x',
        }),
      )
      .mockResolvedValueOnce(json(201, { documentId: 'd1' }));

    await client.reserveDocument('o1', {
      field: 'bankData',
      contentType: 'application/json',
      sizeBytes: 5,
    });
    await client.completeDocument('o1', 'd1');

    const [first, second] = fetchMock.mock.calls as [string, RequestInit][];
    expect(first[0]).toBe('http://engine:3000/v1/onboardings/o1/documents');
    expect(JSON.parse(first[1].body as string)).toEqual({
      field: 'bankData',
      contentType: 'application/json',
      sizeBytes: 5,
    });
    expect(second[0]).toBe('http://engine:3000/v1/onboardings/o1/documents/d1/complete');
    expect(JSON.parse(second[1].body as string)).toEqual({});
  });

  it('turns an engine {code, message, errors} failure into an EngineError', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { email: ['REQUIRED'] },
      }),
    );

    const error = await client.submit('o1', {}).catch((e) => e);

    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({
      status: 400,
      code: 'INVALID_STEP_DATA',
      errors: { email: ['REQUIRED'] },
      isTransport: false,
      isValidationShape: false,
    });
  });

  it('recognises the ValidationPipe shape, which has no code', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        message: ['workflowId should not be empty'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    const error = await client.startOnboarding('').catch((e) => e);

    expect(error).toMatchObject({ status: 400, code: undefined, isValidationShape: true });
    expect(error.message).toBe('workflowId should not be empty');
  });

  it('keeps the status when an error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));

    await expect(client.getState('o1')).rejects.toMatchObject({ status: 502, code: undefined });
  });

  it('reports a transport failure with a null status', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await client.getState('o1').catch((e) => e);

    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({ status: null, isTransport: true });
  });

  it('reports an unreadable 2xx body as a transport failure', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));

    await expect(client.getState('o1')).rejects.toMatchObject({ status: null });
  });
});
