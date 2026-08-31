import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { SumsubSubmissionIncompleteError } from '../../../errors/sumsub-submission-incomplete.error';
import { SumsubUnavailableException } from '../../../errors/sumsub-unavailable.exception';
import { SumsubClient, type SumsubCredentials } from './sumsub-client';

const BASE_URL = 'https://api.sumsub.com';

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        SUMSUB_BASE_URL: BASE_URL,
        SUMSUB_TIMEOUT_MS: 1000,
      };

      return values[key];
    }),
  }) as unknown as ConfigService<AppConfig, true>;

const credentials = (secretKey = 'secret-key-1'): SumsubCredentials => ({
  appToken: 'app-token-1',
  secretKey,
});

type MockResponseInit = {
  status: number;
  bodyText?: string;
  headers?: Record<string, string>;
};

const createResponse = ({ status, bodyText = '', headers = {} }: MockResponseInit) => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(bodyText),
  headers: {
    get: (name: string) => {
      const match = Object.entries(headers).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      );

      return match ? match[1] : null;
    },
  },
});

const computeSignature = (
  secretKey: string,
  ts: string,
  method: string,
  path: string,
  body?: Buffer,
): string => {
  const prefix = Buffer.from(`${ts}${method}${path}`, 'utf-8');
  const bytes = body ? Buffer.concat([prefix, body]) : prefix;

  return createHmac('sha256', secretKey).update(bytes).digest('hex');
};

type FetchCallArgs = [string, RequestInit & { headers: Record<string, string> }];

describe('SumsubClient', () => {
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

  it('signs a JSON call over ts + METHOD + path + body and sends the App-Token/Ts/Sig headers', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({ status: 201, bodyText: JSON.stringify({ id: 'applicant-1' }) }),
    );

    const applicantId = await client.createApplicant(credentials(), 'individual-standard-v2', {
      externalUserId: 'user-1',
    });

    expect(applicantId).toBe('applicant-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as FetchCallArgs;
    const path = '/resources/applicants?levelName=individual-standard-v2';
    expect(url).toBe(`${BASE_URL}${path}`);
    expect(init.method).toBe('POST');
    expect(init.headers['X-App-Token']).toBe('app-token-1');

    const bodyBuffer = Buffer.from(JSON.stringify({ externalUserId: 'user-1' }), 'utf-8');
    expect(Buffer.from(init.body as Uint8Array).toString('utf-8')).toBe(
      bodyBuffer.toString('utf-8'),
    );

    const expectedSignature = computeSignature(
      'secret-key-1',
      init.headers['X-App-Access-Ts'],
      'POST',
      path,
      bodyBuffer,
    );
    expect(init.headers['X-App-Access-Sig']).toBe(expectedSignature);
  });

  it('signs the multipart upload over the exact bytes transmitted, with a matching Content-Type boundary', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({ status: 200, headers: { 'X-Image-Id': 'image-42' } }),
    );

    const fileContent = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    const imageId = await client.uploadIdDoc(credentials(), {
      applicantId: 'applicant-1',
      metadata: { idDocType: 'PASSPORT', country: 'USA' },
      fileName: 'passport.jpg',
      contentType: 'image/jpeg',
      fileContent,
    });

    expect(imageId).toBe('image-42');

    const [url, init] = fetchMock.mock.calls[0] as FetchCallArgs;
    const path = '/resources/applicants/applicant-1/info/idDoc';
    expect(url).toBe(`${BASE_URL}${path}`);

    const contentType = init.headers['Content-Type'];
    const boundary = contentType.match(/boundary=(.+)$/)?.[1];
    expect(boundary).toBeTruthy();

    const transmittedBody = Buffer.from(init.body as Uint8Array);
    expect(transmittedBody.toString('latin1')).toContain(`--${boundary}`);
    expect(transmittedBody.includes(fileContent)).toBe(true);

    const expectedSignature = computeSignature(
      'secret-key-1',
      init.headers['X-App-Access-Ts'],
      'POST',
      path,
      transmittedBody,
    );
    expect(init.headers['X-App-Access-Sig']).toBe(expectedSignature);
  });

  it('returns the parsed existing applicant id on a 409 from createApplicant', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 409,
        bodyText: JSON.stringify({
          description:
            "Applicant with external user id 'user-1' already exists: applicant id 5f9d5aa70a7c6a0013dbd8ac",
        }),
      }),
    );

    const applicantId = await client.createApplicant(credentials(), 'individual-standard-v2', {});

    expect(applicantId).toBe('5f9d5aa70a7c6a0013dbd8ac');
  });

  it('throws a typed error naming the incomplete docSets on a 409 from finalizeSubmission', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 409,
        bodyText: JSON.stringify({
          description: 'Applicant applicant-1 required id docs missing: IDENTITY, SELFIE',
        }),
      }),
    );

    const error = await client
      .finalizeSubmission(credentials(), 'applicant-1')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SumsubSubmissionIncompleteError);
    expect((error as SumsubSubmissionIncompleteError).missingDocSets).toEqual([
      'IDENTITY',
      'SELFIE',
    ]);
  });

  it('distinguishes an absent AML case (204) from an empty-hits case (200)', async () => {
    const client = new SumsubClient(createConfigService());

    fetchMock.mockResolvedValueOnce(createResponse({ status: 204 }));
    await expect(client.findAmlCase(credentials(), 'applicant-1')).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(
      createResponse({ status: 200, bodyText: JSON.stringify({ hits: [] }) }),
    );
    await expect(client.findAmlCase(credentials(), 'applicant-1')).resolves.toEqual({ hits: [] });

    const [url] = fetchMock.mock.calls[0] as FetchCallArgs;
    expect(url).toBe(`${BASE_URL}/resources/api/applicants/applicant-1/amlCase`);
  });

  it('surfaces a network failure or timeout as SumsubUnavailableException', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockRejectedValueOnce(new Error('The operation was aborted'));

    await expect(client.findApplicantStatus(credentials(), 'applicant-1')).rejects.toBeInstanceOf(
      SumsubUnavailableException,
    );
  });

  it('findLevel selects the configured level by name and returns undefined when absent', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        bodyText: JSON.stringify({
          list: {
            items: [{ name: 'individual-standard-v2' }, { name: 'business-v1' }],
            totalItems: 2,
          },
        }),
      }),
    );

    await expect(client.findLevel(credentials(), 'individual-standard-v2')).resolves.toEqual({
      name: 'individual-standard-v2',
      docSets: [],
    });

    const [url] = fetchMock.mock.calls[0] as FetchCallArgs;
    expect(url).toBe(`${BASE_URL}/resources/applicants/-/levels`);

    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        bodyText: JSON.stringify({
          list: { items: [{ name: 'individual-standard-v2' }], totalItems: 1 },
        }),
      }),
    );

    await expect(client.findLevel(credentials(), 'unknown-level')).resolves.toBeUndefined();
  });

  it('findLevel reports an unenveloped body as unavailable rather than as a missing level', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        bodyText: JSON.stringify([{ name: 'individual-standard-v2' }]),
      }),
    );

    await expect(client.findLevel(credentials(), 'individual-standard-v2')).rejects.toBeInstanceOf(
      SumsubUnavailableException,
    );
  });

  it('findLevel parses docSets from the matched level entry, surviving the round trip', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        bodyText: JSON.stringify({
          list: {
            items: [
              {
                name: 'individual-standard-v2',
                requiredIdDocs: {
                  docSets: [
                    { idDocSetType: 'IDENTITY', types: ['PASSPORT'] },
                    { idDocSetType: 'SELFIE' },
                    { fields: [] },
                  ],
                },
              },
            ],
            totalItems: 1,
          },
        }),
      }),
    );

    await expect(client.findLevel(credentials(), 'individual-standard-v2')).resolves.toEqual({
      name: 'individual-standard-v2',
      docSets: [{ idDocSetType: 'IDENTITY' }, { idDocSetType: 'SELFIE' }],
    });
  });

  it('findApplicantStatus reads reviewStatus, reviewResult.reviewAnswer and reviewResult.reviewRejectType from /status', async () => {
    const client = new SumsubClient(createConfigService());
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        bodyText: JSON.stringify({
          reviewStatus: 'completed',
          reviewResult: {
            reviewAnswer: 'RED',
            reviewRejectType: 'RETRY',
            moderationComment: 'blurry photo',
          },
        }),
      }),
    );

    const result = await client.findApplicantStatus(credentials(), 'applicant-1');

    expect(result).toEqual({
      reviewStatus: 'completed',
      reviewResult: {
        reviewAnswer: 'RED',
        reviewRejectType: 'RETRY',
        moderationComment: 'blurry photo',
        buttonIds: undefined,
      },
    });

    const [url] = fetchMock.mock.calls[0] as FetchCallArgs;
    expect(url).toBe(`${BASE_URL}/resources/applicants/applicant-1/status`);
  });

  it('signs with the credentials passed to each call, never a held instance secret', async () => {
    const client = new SumsubClient(createConfigService());
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    fetchMock.mockResolvedValueOnce(
      createResponse({ status: 200, bodyText: JSON.stringify({ reviewStatus: 'init' }) }),
    );
    await client.findApplicantStatus(credentials('secret-key-1'), 'applicant-1');

    fetchMock.mockResolvedValueOnce(
      createResponse({ status: 200, bodyText: JSON.stringify({ reviewStatus: 'init' }) }),
    );
    await client.findApplicantStatus(credentials('secret-key-2'), 'applicant-1');

    nowSpy.mockRestore();

    const [, firstInit] = fetchMock.mock.calls[0] as FetchCallArgs;
    const [, secondInit] = fetchMock.mock.calls[1] as FetchCallArgs;

    expect(firstInit.headers['X-App-Access-Ts']).toBe(secondInit.headers['X-App-Access-Ts']);
    expect(firstInit.headers['X-App-Access-Sig']).not.toBe(secondInit.headers['X-App-Access-Sig']);
  });

  it('never logs a secret, a signature, or a request body', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const client = new SumsubClient(createConfigService());
    const secretKey = 'super-secret-value';
    const bodyMarker = 'unique-body-marker-xyz';

    fetchMock.mockResolvedValueOnce(
      createResponse({ status: 201, bodyText: JSON.stringify({ id: 'applicant-1' }) }),
    );
    await client.createApplicant(credentials(secretKey), 'individual-standard-v2', {
      note: bodyMarker,
    });

    fetchMock.mockResolvedValueOnce(
      createResponse({ status: 200, headers: { 'X-Image-Id': 'image-1' } }),
    );
    await client.uploadIdDoc(credentials(secretKey), {
      applicantId: 'applicant-1',
      metadata: { idDocType: 'PASSPORT', country: 'USA' },
      fileName: 'f.jpg',
      contentType: 'image/jpeg',
      fileContent: Buffer.from([1, 2, 3]),
    });

    const [, firstInit] = fetchMock.mock.calls[0] as FetchCallArgs;
    const signature = firstInit.headers['X-App-Access-Sig'];

    const loggedMessages = debugSpy.mock.calls.map((call) => call.join(' '));

    expect(loggedMessages.length).toBeGreaterThan(0);
    for (const message of loggedMessages) {
      expect(message).not.toContain(secretKey);
      expect(message).not.toContain(signature);
      expect(message).not.toContain(bodyMarker);
    }

    debugSpy.mockRestore();
  });
});
