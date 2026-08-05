import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import { TwilioVerifyConnector } from './twilio-verify.connector';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        TWILIO_ACCOUNT_SID: 'AC123',
        TWILIO_AUTH_TOKEN: 'auth-token',
        TWILIO_VERIFY_SERVICE_SID: 'VA123',
        TWILIO_VERIFY_TIMEOUT_MS: 1000,
      };

      return values[key];
    }),
  }) as unknown as ConfigService<AppConfig, true>;

const createInput = (operation: string, recipient = '+15551234567', code?: string) => ({
  declaration: {
    order: 1,
    config: { operation },
  },
  execution: { onboardingId: 'onboarding-1', stepName: 'request_code' },
  context: {},
  payload: {
    ...(recipient ? { recipient } : {}),
    ...(code !== undefined ? { code } : {}),
  },
  payloadFieldSources: {
    recipient: 'phoneNumber',
    code: 'verificationCode',
  },
});

describe('TwilioVerifyConnector', () => {
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

  it('returns invalid without contacting Twilio for malformed input or unsupported operations', async () => {
    const connector = new TwilioVerifyConnector(createConfigService());

    await expect(connector.execute(createInput('unsupported'))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    await expect(connector.execute({ ...createInput('startVerification', '') })).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    await expect(
      connector.execute({ ...createInput('checkVerification', '+15551234567', '') }),
    ).resolves.toEqual(ConnectorExecutionResult.invalid());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps start and approved check results to accepted', async () => {
    const connector = new TwilioVerifyConnector(createConfigService());

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: jest.fn().mockResolvedValue(JSON.stringify({ status: 'pending' })),
    } as never);

    await expect(connector.execute(createInput('startVerification'))).resolves.toEqual(
      ConnectorExecutionResult.accepted(),
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ status: 'approved' })),
    } as never);

    await expect(
      connector.execute(createInput('checkVerification', '+15551234567', '123456')),
    ).resolves.toEqual(ConnectorExecutionResult.accepted());

    const startCall = fetchMock.mock.calls[0];
    const startBody = new URLSearchParams(
      String((startCall[1] as RequestInit | undefined)?.body ?? ''),
    );
    expect(startCall[0]).toBe('https://verify.twilio.com/v2/Services/VA123/Verifications');
    expect(startBody.get('To')).toBe('+15551234567');
    expect(startBody.get('Channel')).toBe('sms');

    const checkCall = fetchMock.mock.calls[1];
    const checkBody = new URLSearchParams(
      String((checkCall[1] as RequestInit | undefined)?.body ?? ''),
    );
    expect(checkCall[0]).toBe('https://verify.twilio.com/v2/Services/VA123/VerificationChecks');
    expect(checkBody.get('To')).toBe('+15551234567');
    expect(checkBody.get('Code')).toBe('123456');
  });

  it('maps retryable wrong-code outcomes to invalid-data with retry metadata', async () => {
    const connector = new TwilioVerifyConnector(createConfigService());

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ status: 'pending', valid: false })),
    } as never);

    await expect(
      connector.execute(createInput('checkVerification', '+15551234567', '000000')),
    ).resolves.toEqual(
      ConnectorExecutionResult.invalidData(
        { verificationCode: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );
  });

  it.each([
    ['expired', 'expired', 'CHALLENGE_EXPIRED'],
    ['missing', 'not_found', 'CHALLENGE_NOT_FOUND'],
    ['exhausted', 'max_attempts_exceeded', 'ATTEMPTS_EXHAUSTED'],
    ['terminal denial', 'canceled', 'CONNECTOR_REJECTED'],
  ])('maps %s provider responses to rejected results', async (_label, status, reason) => {
    const connector = new TwilioVerifyConnector(createConfigService());

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ status })),
    } as never);

    await expect(
      connector.execute(createInput('checkVerification', '+15551234567', '123456')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected(reason as never));
  });

  it.each([
    ['an unrecognized status', JSON.stringify({ status: 'unknown' })],
    ['a missing status', JSON.stringify({})],
  ])(
    'throws the safe operational-failure exception for check responses with %s',
    async (_label, body) => {
      const connector = new TwilioVerifyConnector(createConfigService());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(body),
      } as never);

      await expect(
        connector.execute(createInput('checkVerification', '+15551234567', '123456')),
      ).rejects.toMatchObject({
        response: {
          code: 'TWILIO_VERIFY_UNAVAILABLE',
          message: 'TWILIO_VERIFY_UNAVAILABLE',
        },
      });
    },
  );

  it('throws the safe operational-failure exception for provider failures', async () => {
    const connector = new TwilioVerifyConnector(createConfigService());

    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    await expect(connector.execute(createInput('startVerification'))).rejects.toMatchObject({
      response: {
        code: 'TWILIO_VERIFY_UNAVAILABLE',
        message: 'TWILIO_VERIFY_UNAVAILABLE',
      },
    });
  });

  it.each([
    ['timeout', () => fetchMock.mockRejectedValueOnce(new Error('timeout'))],
    ['network', () => fetchMock.mockRejectedValueOnce(new TypeError('network down'))],
    [
      'auth failure',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: jest.fn().mockResolvedValue('unauthorized'),
        } as never),
    ],
    [
      'configuration failure',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: jest.fn().mockResolvedValue('forbidden'),
        } as never),
    ],
    [
      'outage',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue('service unavailable'),
        } as never),
    ],
    [
      'rate limit',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: jest.fn().mockResolvedValue('too many requests'),
        } as never),
    ],
  ])('throws the safe operational-failure exception for %s', async (_label, arrangeFailure) => {
    const connector = new TwilioVerifyConnector(createConfigService());

    arrangeFailure();

    await expect(connector.execute(createInput('startVerification'))).rejects.toMatchObject({
      response: {
        code: 'TWILIO_VERIFY_UNAVAILABLE',
        message: 'TWILIO_VERIFY_UNAVAILABLE',
      },
    });
  });
});
