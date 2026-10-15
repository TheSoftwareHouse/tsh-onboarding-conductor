import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { AppConfig } from '../../../config/app.config';
import { ConnectorSettingsService } from '../../connector-settings.service';
import { OtpDeliveryFailedException } from '../../errors/otp-delivery-failed.exception';
import { OtpChallengesConnection } from '../../otp-challenges.connection';
import { OtpChallengesRepository } from '../../otp-challenges.repository';
import type { ConnectorSettingsSchema } from '../../ports/connector-adapter.port';
import {
  BaseOtpConnector,
  OTP_DELIVERY_OUTCOMES,
  type OtpDeliveryOutcome,
} from './otp/base-otp.connector';

const TWILIO_MESSAGES_BASE_URL = 'https://api.twilio.com/2010-04-01/Accounts';
const ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;

/**
 * Twilio error codes that refuse the `To` number itself rather than the request: an invalid number
 * (21211), one SMS cannot reach (21612), a landline (21614) and a recipient who opted out (21610).
 * The person has to give another number; anything else is the provider's or the operator's problem.
 */
const TWILIO_INVALID_RECIPIENT_CODES: ReadonlySet<number> = new Set([21211, 21610, 21612, 21614]);

type TwilioErrorBody = { readonly code?: unknown };

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

  protected async deliver(recipient: string, code: string): Promise<OtpDeliveryOutcome> {
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

    const response = await fetch(
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
    ).catch((): never => {
      throw new OtpDeliveryFailedException();
    });

    if (response.ok) {
      // Read to the end so undici returns the connection to its pool. The message is already
      // accepted, so a body that fails to arrive does not fail the delivery.
      await response.arrayBuffer().catch(() => undefined);
      return OTP_DELIVERY_OUTCOMES.delivered;
    }

    const errorCode = await this.readErrorCode(response);
    if (errorCode !== undefined && TWILIO_INVALID_RECIPIENT_CODES.has(errorCode)) {
      return OTP_DELIVERY_OUTCOMES.invalidRecipient;
    }

    throw new OtpDeliveryFailedException();
  }

  /** Twilio's numeric error `code` from an error response, consuming its body either way. */
  private async readErrorCode(response: Response): Promise<number | undefined> {
    const errorBody = (await response.json().catch(() => undefined)) as TwilioErrorBody | undefined;
    return typeof errorBody?.code === 'number' ? errorBody.code : undefined;
  }
}
