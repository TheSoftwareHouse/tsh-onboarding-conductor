import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { AppConfig } from '../../../../config/app.config';
import { ConnectorSettingsService } from '../../../connector-settings.service';
import { OtpDeliveryFailedException } from '../../../errors/otp-delivery-failed.exception';
import type { ConnectorSettingDefinition } from '../../../ports/connector-adapter.port';
import type { OtpChannel } from '../../../ports/otp-channel.port';
import { OTP_CONNECTOR_ID } from './otp.constants';

const TWILIO_MESSAGES_BASE_URL = 'https://api.twilio.com/2010-04-01/Accounts';
const ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;

export const OTP_SMS_BODY_PREFIX = 'Your verification code is';

@Injectable()
export class SmsOtpChannel implements OtpChannel {
  readonly channel: OtpChannelName = 'sms';

  readonly settingsFields: readonly ConnectorSettingDefinition[] = [
    { key: 'twilioAccountSid', secret: false, required: false, pattern: ACCOUNT_SID_PATTERN },
    { key: 'twilioAuthToken', secret: true, required: false },
    {
      key: 'twilioMessagingServiceSid',
      secret: false,
      required: false,
      pattern: MESSAGING_SERVICE_SID_PATTERN,
    },
  ];

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly connectorSettingsService: ConnectorSettingsService,
  ) {}

  async send(recipient: string, code: string): Promise<void> {
    const timeoutMs = this.configService.getOrThrow<number>('OTP_SMS_TIMEOUT_MS');
    const settings = await this.connectorSettingsService.resolve({ id: OTP_CONNECTOR_ID });
    const accountSid = settings.get('twilioAccountSid');
    const authToken = settings.get('twilioAuthToken');
    const messagingServiceSid = settings.get('twilioMessagingServiceSid');

    const body = new URLSearchParams({
      To: recipient,
      MessagingServiceSid: messagingServiceSid,
      Body: `${OTP_SMS_BODY_PREFIX} ${code}.`,
    });

    let response: Response;
    try {
      response = await fetch(
        `${TWILIO_MESSAGES_BASE_URL}/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch {
      throw new OtpDeliveryFailedException();
    }

    if (!response.ok) {
      throw new OtpDeliveryFailedException();
    }
  }
}
