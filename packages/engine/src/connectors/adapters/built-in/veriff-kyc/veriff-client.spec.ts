import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { VeriffUnavailableException } from '../../../errors/veriff-unavailable.exception';
import { VeriffClient, type VeriffCredentials } from './veriff-client';
import { VERIFF_MEDIA_CONTEXT_FACE } from './veriff-contract';

const BASE_URL = 'https://stationapi.veriff.com';

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        VERIFF_BASE_URL: BASE_URL,
        VERIFF_TIMEOUT_MS: 1000,
      };

      return values[key];
    }),
  }) as unknown as ConfigService<AppConfig, true>;

const credentials: VeriffCredentials = { apiKey: 'api-key-1', sharedSecretKey: 'shared-secret-1' };

const createResponse = (status: number, bodyText = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(bodyText),
});

const sign = (bytes: Buffer | string) =>
  createHmac('sha256', credentials.sharedSecretKey).update(bytes).digest('hex');

type FetchCallArgs = [string, RequestInit & { headers: Record<string, string> }];

describe('VeriffClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterAll(() => {
    delete (global as { fetch?: unknown }).fetch;
  });

  const person = { firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-02' };

  it('creates a session with a signed POST and returns its id', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(
        201,
        JSON.stringify({ status: 'success', verification: { id: 'session-1', status: 'created' } }),
      ),
    );

    const session = await client.createSession(credentials, {
      vendorData: 'onboarding-1',
      person,
      document: { type: 'PASSPORT', country: 'PL' },
    });

    const [url, init] = fetchMock.mock.calls[0] as FetchCallArgs;
    const sent = Buffer.from(init.body as Uint8Array);
    const parsed = JSON.parse(sent.toString('utf-8')) as {
      verification: Record<string, unknown>;
    };

    expect(session).toEqual({ id: 'session-1', status: 'created' });
    expect(url).toBe(`${BASE_URL}/v1/sessions`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-auth-client']).toBe('api-key-1');
    expect(init.headers['x-hmac-signature']).toBe(sign(sent));
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(parsed.verification).toMatchObject({
      vendorData: 'onboarding-1',
      person,
      document: { type: 'PASSPORT', country: 'PL' },
    });
    expect(typeof parsed.verification.timestamp).toBe('string');
  });

  it('omits document when none is requested', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(201, JSON.stringify({ status: 'success', verification: { id: 's' } })),
    );

    await client.createSession(credentials, { vendorData: 'v', person });

    const [, init] = fetchMock.mock.calls[0] as FetchCallArgs;
    const parsed = JSON.parse(Buffer.from(init.body as Uint8Array).toString()) as {
      verification: Record<string, unknown>;
    };

    expect(parsed.verification).not.toHaveProperty('document');
  });

  it('rejects a session response without status success', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(200, JSON.stringify({ status: 'fail', verification: { id: 's' } })),
    );

    await expect(client.createSession(credentials, { vendorData: 'v', person })).rejects.toThrow(
      VeriffUnavailableException,
    );
  });

  it('uploads media as a data URI with the given content type and returns the image id', async () => {
    const client = new VeriffClient(createConfigService());
    const content = Buffer.from([1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce(
      createResponse(200, JSON.stringify({ status: 'success', image: { id: 'image-1' } })),
    );

    const imageId = await client.uploadMedia(credentials, {
      sessionId: 'session-1',
      context: VERIFF_MEDIA_CONTEXT_FACE,
      contentType: 'image/jpeg',
      content,
    });

    const [url, init] = fetchMock.mock.calls[0] as FetchCallArgs;
    const sent = Buffer.from(init.body as Uint8Array);

    expect(imageId).toBe('image-1');
    expect(url).toBe(`${BASE_URL}/v1/sessions/session-1/media`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-hmac-signature']).toBe(sign(sent));
    expect(JSON.parse(sent.toString('utf-8'))).toEqual({
      image: { context: 'face', content: `data:image/jpeg;base64,${content.toString('base64')}` },
    });
  });

  it('rejects a media response without an image id', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(createResponse(200, JSON.stringify({ status: 'success' })));

    await expect(
      client.uploadMedia(credentials, {
        sessionId: 's',
        context: VERIFF_MEDIA_CONTEXT_FACE,
        contentType: 'image/png',
        content: Buffer.from('x'),
      }),
    ).rejects.toThrow(VeriffUnavailableException);
  });

  it('submits a session with a signed PATCH', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(createResponse(200, JSON.stringify({ status: 'success' })));

    await client.submitSession(credentials, 'session-1');

    const [url, init] = fetchMock.mock.calls[0] as FetchCallArgs;
    const sent = Buffer.from(init.body as Uint8Array);

    expect(url).toBe(`${BASE_URL}/v1/sessions/session-1`);
    expect(init.method).toBe('PATCH');
    expect(init.headers['x-hmac-signature']).toBe(sign(sent));
    expect(JSON.parse(sent.toString('utf-8'))).toEqual({ verification: { status: 'submitted' } });
  });

  it('signs the decision GET over the session id and parses the decision', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(
        200,
        JSON.stringify({
          status: 'success',
          verification: {
            id: 'decision-1',
            attemptId: 'attempt-1',
            status: 'declined',
            code: 9102,
            reason: 'Document expired',
            reasonCode: 102,
            vendorData: 'onboarding-1',
            person: { firstName: 'Ada' },
            document: { type: 'PASSPORT' },
          },
        }),
      ),
    );

    const decision = await client.findDecision(credentials, 'session-1');

    const [url, init] = fetchMock.mock.calls[0] as FetchCallArgs;

    expect(url).toBe(`${BASE_URL}/v1/sessions/session-1/decision`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers['x-auth-client']).toBe('api-key-1');
    expect(init.headers['x-hmac-signature']).toBe(sign('session-1'));
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(decision).toEqual({
      id: 'decision-1',
      attemptId: 'attempt-1',
      status: 'declined',
      code: 9102,
      reason: 'Document expired',
      reasonCode: 102,
      vendorData: 'onboarding-1',
      person: { firstName: 'Ada' },
      document: { type: 'PASSPORT' },
    });
  });

  it('returns undefined while the verification is null', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(200, JSON.stringify({ status: 'success', verification: null })),
    );

    await expect(client.findDecision(credentials, 'session-1')).resolves.toBeUndefined();
  });

  it('parses a numeric decision code', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(
        200,
        JSON.stringify({ verification: { id: 'd', status: 'approved', code: 9001 } }),
      ),
    );

    const decision = await client.findDecision(credentials, 'session-1');

    expect(decision?.code).toBe(9001);
  });

  it('drops decision fields of the wrong type', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(
        200,
        JSON.stringify({
          verification: { id: 'd', status: 'approved', code: '9001', reasonCode: null },
        }),
      ),
    );

    const decision = await client.findDecision(credentials, 'session-1');

    expect(decision?.code).toBeUndefined();
    expect(decision?.reasonCode).toBeUndefined();
  });

  it('rejects a decision whose status is not a string', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(200, JSON.stringify({ verification: { id: 'd', status: 1 } })),
    );

    await expect(client.findDecision(credentials, 'session-1')).rejects.toThrow(
      VeriffUnavailableException,
    );
  });

  it('surfaces a PATCH 409 as VeriffUnavailableException', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(createResponse(409, JSON.stringify({ status: 'fail' })));

    await expect(client.submitSession(credentials, 'session-1')).rejects.toThrow(
      VeriffUnavailableException,
    );
  });

  it('warns with the HTTP status on a 401 and still throws VeriffUnavailableException', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse(401, JSON.stringify({ status: 'fail', message: 'bad api key' })),
    );

    await expect(client.findDecision(credentials, 'session-1')).rejects.toThrow(
      VeriffUnavailableException,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'VERIFF_RESPONSE_ERROR method=GET path=/v1/sessions/session-1/decision status=401',
    );
  });

  it('warns with the error name on a network failure and throws VeriffUnavailableException', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const client = new VeriffClient(createConfigService());
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed: https://leaked.example'));

    await expect(client.findDecision(credentials, 'session-1')).rejects.toThrow(
      VeriffUnavailableException,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'VERIFF_REQUEST_FAILED method=GET path=/v1/sessions/session-1/decision error=TypeError timeoutMs=1000',
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('leaked');
  });

  it('warns with TimeoutError on a timeout and throws VeriffUnavailableException', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const client = new VeriffClient(createConfigService());
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

    await expect(client.submitSession(credentials, 'session-1')).rejects.toThrow(
      VeriffUnavailableException,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'VERIFF_REQUEST_FAILED method=PATCH path=/v1/sessions/session-1 error=TimeoutError timeoutMs=1000',
    );
  });

  it('surfaces malformed JSON as VeriffUnavailableException', async () => {
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(createResponse(200, '<html>'));

    await expect(client.findDecision(credentials, 'session-1')).rejects.toThrow(
      VeriffUnavailableException,
    );
  });

  it('logs only method and path, never the secret, signature or body', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const client = new VeriffClient(createConfigService());
    fetchMock.mockResolvedValueOnce(createResponse(200, JSON.stringify({ status: 'success' })));

    await client.submitSession(credentials, 'session-1');

    const [, init] = fetchMock.mock.calls[0] as FetchCallArgs;
    const logged = debugSpy.mock.calls.map((call) => String(call[0])).join('\n');

    expect(logged).toBe('VERIFF_REQUEST method=PATCH path=/v1/sessions/session-1');
    expect(logged).not.toContain(credentials.sharedSecretKey);
    expect(logged).not.toContain(init.headers['x-hmac-signature']);
    expect(logged).not.toContain('submitted');
    debugSpy.mockRestore();
  });
});
