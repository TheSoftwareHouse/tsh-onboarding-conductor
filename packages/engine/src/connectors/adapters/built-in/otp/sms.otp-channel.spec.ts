import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import type { ConnectorSettingsService } from '../../../connector-settings.service';
import { ConnectorNotConfiguredException } from '../../../errors/connector-not-configured.exception';
import { OtpDeliveryFailedException } from '../../../errors/otp-delivery-failed.exception';
import { OTP_CONNECTOR_ID } from './otp.constants';
import { OTP_SMS_BODY_PREFIX, SmsOtpChannel } from './sms.otp-channel';

const ACCOUNT_SID = `AC${'a'.repeat(32)}`;
const MESSAGING_SERVICE_SID = `MG${'b'.repeat(32)}`;
const AUTH_TOKEN = 'auth-token';
const RECIPIENT = '+15551234567';
const CODE = '123456';
const TIMEOUT_MS = 1000;

const createConfigService = () =>
  ({
    getOrThrow: jest.fn((key: string) => (key === 'OTP_SMS_TIMEOUT_MS' ? TIMEOUT_MS : undefined)),
  }) as unknown as ConfigService<AppConfig, true>;

const createSettingsService = (
  values: Record<string, string> = {
    twilioAccountSid: ACCOUNT_SID,
    twilioAuthToken: AUTH_TOKEN,
    twilioMessagingServiceSid: MESSAGING_SERVICE_SID,
  },
) => {
  const resolve = jest.fn().mockResolvedValue({
    find: (key: string) => values[key],
    get: (key: string) => {
      if (values[key] === undefined) {
        throw new ConnectorNotConfiguredException(OTP_CONNECTOR_ID, key);
      }

      return values[key];
    },
  });

  return { resolve, service: { resolve } as unknown as ConnectorSettingsService };
};

describe('SmsOtpChannel', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('declares the sms channel with three optional settings, the token secret', () => {
    const channel = new SmsOtpChannel(createConfigService(), createSettingsService().service);

    expect(channel.channel).toBe('sms');
    expect(channel.settingsFields.map((field) => field.key)).toEqual([
      'twilioAccountSid',
      'twilioAuthToken',
      'twilioMessagingServiceSid',
    ]);
    expect(channel.settingsFields.every((field) => !field.required)).toBe(true);
    expect(channel.settingsFields.filter((field) => field.secret)).toHaveLength(1);
  });

  it('posts the message to the Twilio Messages API with basic auth', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    const { resolve, service } = createSettingsService();
    const channel = new SmsOtpChannel(createConfigService(), service);

    await channel.send(RECIPIENT, CODE);

    expect(resolve).toHaveBeenCalledWith({ id: OTP_CONNECTOR_ID });
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
    expect(params.get('Body')).toBe(`${OTP_SMS_BODY_PREFIX} ${CODE}.`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws OtpDeliveryFailedException on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const channel = new SmsOtpChannel(createConfigService(), createSettingsService().service);

    await expect(channel.send(RECIPIENT, CODE)).rejects.toBeInstanceOf(OtpDeliveryFailedException);
  });

  it('throws OtpDeliveryFailedException on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    const channel = new SmsOtpChannel(createConfigService(), createSettingsService().service);

    await expect(channel.send(RECIPIENT, CODE)).rejects.toBeInstanceOf(OtpDeliveryFailedException);
  });

  it('throws ConnectorNotConfiguredException when a setting is missing, without calling Twilio', async () => {
    const channel = new SmsOtpChannel(
      createConfigService(),
      createSettingsService({ twilioAccountSid: ACCOUNT_SID }).service,
    );

    await expect(channel.send(RECIPIENT, CODE)).rejects.toBeInstanceOf(
      ConnectorNotConfiguredException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
