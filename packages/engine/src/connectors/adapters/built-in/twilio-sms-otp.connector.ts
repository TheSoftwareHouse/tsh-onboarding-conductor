import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { AppConfig } from '../../../config/app.config';
import { ConnectorSettingsService } from '../../connector-settings.service';
import { OtpDeliveryFailedException } from '../../errors/otp-delivery-failed.exception';
import { OtpChallengesConnection } from '../../otp-challenges.connection';
import { OtpChallengesRepository } from '../../otp-challenges.repository';
import type { ConnectorSettingsSchema } from '../../ports/connector-adapter.port';
import { BaseOtpConnector } from './otp/base-otp.connector';

const TWILIO_MESSAGES_BASE_URL = 'https://api.twilio.com/2010-04-01/Accounts';
const ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;

export const OTP_SMS_BODY_PREFIX = 'Your verification code is';

/** One-time codes by SMS, delivered through Twilio Programmable Messaging. */
@Injectable()
export class TwilioSmsOtpConnector extends BaseOtpConnector {
  readonly id = 'twilio_sms_otp';
  readonly name = 'twilio_sms_otp';
  readonly channel: OtpChannelName = 'sms';
  readonly settingsSchema: ConnectorSettingsSchema = {
    fields: [
      { key: 'accountSid', secret: false, required: true, pattern: ACCOUNT_SID_PATTERN },
      { key: 'authToken', secret: true, required: true },
      {
        key: 'messagingServiceSid',
        secret: false,
        required: true,
        pattern: MESSAGING_SERVICE_SID_PATTERN,
      },
    ],
  };

  constructor(
    connection: OtpChallengesConnection,
    challenges: OtpChallengesRepository,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly connectorSettingsService: ConnectorSettingsService,
  ) {
    super(connection, challenges);
  }

  protected async deliver(recipient: string, code: string): Promise<void> {
    const timeoutMs = this.configService.getOrThrow<number>('OTP_SMS_TIMEOUT_MS');
    const settings = await this.connectorSettingsService.resolve(this);
    const accountSid = settings.get('accountSid');
    const authToken = settings.get('authToken');
    const messagingServiceSid = settings.get('messagingServiceSid');

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
