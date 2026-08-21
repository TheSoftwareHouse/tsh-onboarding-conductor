import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/app.config';
import { createConnectorSettingsStoreFake } from '../../../connector-settings/testing/connector-settings-store.fake';
import { TwilioVerifyUnavailableException } from '../../errors/twilio-verify-unavailable.exception';
import {
  TwilioVerifyConnector,
  TwilioVerifyEndpoint,
  TwilioVerifyErrorCode,
} from './twilio-verify.connector';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';

const CREDENTIALS: Record<string, string> = {
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'auth-token',
  TWILIO_VERIFY_SERVICE_SID: 'VA123',
};

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => (key === 'TWILIO_VERIFY_TIMEOUT_MS' ? 1000 : undefined)),
  }) as unknown as ConfigService<AppConfig, true>;

const createSettings = (values: Record<string, string> = CREDENTIALS) =>
  createConnectorSettingsStoreFake((envVar) => values[envVar]);

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
  const unavailableResponse = {
    code: 'TWILIO_VERIFY_UNAVAILABLE',
    message: 'TWILIO_VERIFY_UNAVAILABLE',
  };

  const expectUnavailable = async (
    execution: Promise<ConnectorExecutionResult>,
    providerMessage?: string,
  ) => {
    const error = await execution.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TwilioVerifyUnavailableException);

    const unavailableError = error as TwilioVerifyUnavailableException;
    expect(unavailableError.getResponse()).toEqual(unavailableResponse);

    if (providerMessage) {
      expect(JSON.stringify(unavailableError.getResponse())).not.toContain(providerMessage);
      expect(JSON.stringify(unavailableError)).not.toContain(providerMessage);
    }
  };

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
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

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

  it('uses the enum-backed endpoint paths for start and check operations', async () => {
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

    expect(TwilioVerifyEndpoint.START_VERIFICATION).toBe('startVerification');
    expect(TwilioVerifyEndpoint.CHECK_VERIFICATION).toBe('checkVerification');

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
    expect(checkCall[0]).toBe('https://verify.twilio.com/v2/Services/VA123/VerificationCheck');
    expect(checkBody.get('To')).toBe('+15551234567');
    expect(checkBody.get('Code')).toBe('123456');
  });

  it('maps start and approved check results to accepted', async () => {
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

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
    expect(checkCall[0]).toBe('https://verify.twilio.com/v2/Services/VA123/VerificationCheck');
    expect(checkBody.get('To')).toBe('+15551234567');
    expect(checkBody.get('Code')).toBe('123456');
  });

  it.each([
    ['pending with valid false', { status: 'pending', valid: false }],
    ['invalid status', { status: 'invalid' }],
  ])(
    'maps retryable wrong-code outcomes to invalid-data with retry metadata for %s',
    async (_label, payload) => {
      const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
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
    },
  );

  it('maps a not-found response with the verification-not-found code to CHALLENGE_NOT_FOUND without leaking provider message', async () => {
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());
    const providerMessage = 'synthetic provider text';

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: HttpStatus.NOT_FOUND,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          code: TwilioVerifyErrorCode.VERIFICATION_NOT_FOUND,
          message: providerMessage,
        }),
      ),
    } as never);

    const result = await connector.execute(
      createInput('checkVerification', '+15551234567', '123456'),
    );

    expect(result).toEqual(ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND'));
    expect(JSON.stringify(result)).not.toContain(providerMessage);
  });

  it('maps a too-many-requests response with the max-attempts code to ATTEMPTS_EXHAUSTED without leaking provider message', async () => {
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());
    const providerMessage = 'synthetic provider text';

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: HttpStatus.TOO_MANY_REQUESTS,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          code: TwilioVerifyErrorCode.MAX_ATTEMPTS_REACHED,
          message: providerMessage,
        }),
      ),
    } as never);

    const result = await connector.execute(
      createInput('checkVerification', '+15551234567', '123456'),
    );

    expect(result).toEqual(ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED'));
    expect(JSON.stringify(result)).not.toContain(providerMessage);
  });

  it('maps HTTP 200 expired status to CHALLENGE_EXPIRED', async () => {
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ status: 'expired' })),
    } as never);

    await expect(
      connector.execute(createInput('checkVerification', '+15551234567', '123456')),
    ).resolves.toEqual(ConnectorExecutionResult.rejected('CHALLENGE_EXPIRED'));
  });

  it.each(['missing', 'not_found'])(
    'maps HTTP 200 %s status to CHALLENGE_NOT_FOUND',
    async (status) => {
      const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({ status })),
      } as never);

      await expect(
        connector.execute(createInput('checkVerification', '+15551234567', '123456')),
      ).resolves.toEqual(ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND'));
    },
  );

  it.each(['max_attempts_reached', 'max_attempts_exceeded', 'max_attempts_exhausted'])(
    'maps HTTP 200 %s status to ATTEMPTS_EXHAUSTED',
    async (status) => {
      const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({ status })),
      } as never);

      await expect(
        connector.execute(createInput('checkVerification', '+15551234567', '123456')),
      ).resolves.toEqual(ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED'));
    },
  );

  it.each(['denied', 'rejected', 'canceled'])(
    'maps HTTP 200 %s status to CONNECTOR_REJECTED',
    async (status) => {
      const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({ status })),
      } as never);

      await expect(
        connector.execute(createInput('checkVerification', '+15551234567', '123456')),
      ).resolves.toEqual(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'));
    },
  );

  it.each([
    [
      'generic rate-limit response with Twilio code 20429',
      {
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: JSON.stringify({ code: 20429, message: 'synthetic provider text' }),
      },
      'synthetic provider text',
    ],
    [
      'rate-limit response with an unknown code',
      {
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: JSON.stringify({ code: 77777, message: 'synthetic provider text' }),
      },
      'synthetic provider text',
    ],
    [
      'rate-limit response with a missing code',
      {
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: JSON.stringify({ message: 'synthetic provider text' }),
      },
      'synthetic provider text',
    ],
  ])('throws the fixed unavailable response for %s', async (_label, response, providerMessage) => {
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

    fetchMock.mockResolvedValueOnce({
      ok: response.ok,
      status: response.status,
      text: jest.fn().mockResolvedValue(response.body),
    } as never);

    await expectUnavailable(
      connector.execute(createInput('checkVerification', '+15551234567', '123456')),
      providerMessage,
    );
  });

  it.each([
    [
      'unknown not-found code',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: HttpStatus.NOT_FOUND,
          text: jest.fn().mockResolvedValue(JSON.stringify({ code: 20499, message: 'not found' })),
        } as never),
    ],
    [
      'malformed non-2xx JSON',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: jest.fn().mockResolvedValue('{not-json'),
        } as never),
    ],
    [
      'auth failure',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: jest
            .fn()
            .mockResolvedValue(JSON.stringify({ code: 20003, message: 'unauthorized' })),
        } as never),
    ],
    [
      'configuration failure',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: jest.fn().mockResolvedValue(JSON.stringify({ code: 20003, message: 'forbidden' })),
        } as never),
    ],
    [
      'outage',
      () =>
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: jest
            .fn()
            .mockResolvedValue(JSON.stringify({ code: 20500, message: 'service unavailable' })),
        } as never),
    ],
    ['network', () => fetchMock.mockRejectedValueOnce(new TypeError('network down'))],
    ['timeout', () => fetchMock.mockRejectedValueOnce(new Error('timeout'))],
  ])('throws the safe operational-failure exception for %s', async (_label, arrangeFailure) => {
    const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

    arrangeFailure();

    await expectUnavailable(
      connector.execute(createInput('checkVerification', '+15551234567', '123456')),
    );
  });

  it.each([
    ['an unrecognized status', JSON.stringify({ status: 'unknown' })],
    ['a missing status', JSON.stringify({})],
  ])(
    'throws the safe unavailable exception for HTTP 200 check responses with %s',
    async (_label, body) => {
      const connector = new TwilioVerifyConnector(createConfigService(), createSettings());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(body),
      } as never);

      await expectUnavailable(
        connector.execute(createInput('checkVerification', '+15551234567', '123456')),
      );
    },
  );
});
