import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { AppConfig } from '../../../config/app.config';
import type { ConnectorSettingsService } from '../../connector-settings.service';
import { ConnectorNotConfiguredException } from '../../errors/connector-not-configured.exception';
import { OtpDeliveryFailedException } from '../../errors/otp-delivery-failed.exception';
import type { OtpChallengesRepository } from '../../otp-challenges.repository';
import type { ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import { OTP_SMS_BODY_PREFIX, TwilioSmsOtpConnector } from './twilio-sms-otp.connector';

const CONNECTOR_ID = 'twilio_sms_otp';

const ACCOUNT_SID = `AC${'a'.repeat(32)}`;
const MESSAGING_SERVICE_SID = `MG${'b'.repeat(32)}`;
const AUTH_TOKEN = 'auth-token';
const RECIPIENT = '+15551234567';
const TIMEOUT_MS = 1000;

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => (key === 'OTP_SMS_TIMEOUT_MS' ? TIMEOUT_MS : undefined)),
  }) as unknown as ConfigService<AppConfig, true>;

const createSettingsService = (
  values: Record<string, string> = {
    accountSid: ACCOUNT_SID,
    authToken: AUTH_TOKEN,
    messagingServiceSid: MESSAGING_SERVICE_SID,
  },
) => {
  const resolve = jest.fn().mockResolvedValue({
    find: (key: string) => values[key],
    get: (key: string) => {
      if (values[key] === undefined) {
        throw new ConnectorNotConfiguredException(CONNECTOR_ID, key);
      }

      return values[key];
    },
  });

  return { resolve, service: { resolve } as unknown as ConnectorSettingsService };
};

const createRepository = () => ({
  find: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockResolvedValue({}),
});

const createConnector = (settingsService = createSettingsService().service) => {
  const repository = createRepository();
  const connector = new TwilioSmsOtpConnector(
    { manager: {} } as unknown as DataSource,
    repository as unknown as OtpChallengesRepository,
    createConfigService(),
    settingsService,
  );

  return { connector, repository };
};

const send = (): ConnectorExecutionInput => ({
  declaration: { order: 0, config: { operation: 'send', channel: 'sms' } },
  execution: { onboardingId: 'onb-1', stepName: 'send_code' },
  context: {},
  payload: { recipient: RECIPIENT },
  payloadFieldSources: { recipient: 'phoneNumber' },
});

const deliveredCode = (fetchMock: jest.Mock): string => {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = new URLSearchParams(init.body as string).get('Body') ?? '';
  return body.slice(OTP_SMS_BODY_PREFIX.length + 1, -1);
};

describe('TwilioSmsOtpConnector', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is an sms otp_verification connector with three required settings, the token secret', () => {
    const { connector } = createConnector();

    expect(connector).toMatchObject({
      id: CONNECTOR_ID,
      name: CONNECTOR_ID,
      type: 'otp_verification',
      channel: 'sms',
    });
    const { fields } = connector.settingsSchema;
    expect(fields.map((field) => field.key)).toEqual([
      'accountSid',
      'authToken',
      'messagingServiceSid',
    ]);
    expect(fields.every((field) => field.required)).toBe(true);
    expect(fields.filter((field) => field.secret).map((field) => field.key)).toEqual(['authToken']);
  });

  it('posts the message to the Twilio Messages API with basic auth', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    const { resolve, service } = createSettingsService();
    const { connector, repository } = createConnector(service);

    expect((await connector.execute(send())).isAccepted()).toBe(true);

    expect(resolve).toHaveBeenCalledWith(connector);
    expect(repository.save).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const params = new URLSearchParams(init.body as string);
    expect(params.get('To')).toBe(RECIPIENT);
    expect(params.get('MessagingServiceSid')).toBe(MESSAGING_SERVICE_SID);
    expect(params.get('Body')).toBe(`${OTP_SMS_BODY_PREFIX} ${deliveredCode(fetchMock)}.`);
    expect(deliveredCode(fetchMock)).toMatch(/^\d{6}$/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws OtpDeliveryFailedException on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const { connector, repository } = createConnector();

    await expect(connector.execute(send())).rejects.toBeInstanceOf(OtpDeliveryFailedException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('throws OtpDeliveryFailedException on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    const { connector, repository } = createConnector();

    await expect(connector.execute(send())).rejects.toBeInstanceOf(OtpDeliveryFailedException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('throws ConnectorNotConfiguredException when a setting is missing, without calling Twilio', async () => {
    const { connector } = createConnector(
      createSettingsService({ accountSid: ACCOUNT_SID }).service,
    );

    await expect(connector.execute(send())).rejects.toBeInstanceOf(ConnectorNotConfiguredException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
