import { Injectable } from '@nestjs/common';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { OtpDeliveryFailedException } from '../../../errors/otp-delivery-failed.exception';
import type { ConnectorSettingDefinition } from '../../../ports/connector-adapter.port';
import type { OtpChannel } from '../../../ports/otp-channel.port';
import { SmtpConnector } from '../smtp.connector';

export const OTP_EMAIL_SUBJECT = 'Your verification code';
export const OTP_EMAIL_TEMPLATE_PATH = 'built-in/otp-code.html';

/** SMTP ignores the execution identity; the channel has no onboarding to name. */
const OTP_EMAIL_EXECUTION = { onboardingId: 'otp', stepName: 'otp' } as const;
const OTP_EMAIL_DECLARATION_ORDER = 0;

@Injectable()
export class EmailOtpChannel implements OtpChannel {
  readonly channel: OtpChannelName = 'email';

  /** Delivery runs through `SmtpConnector`, which owns its own settings. */
  readonly settingsFields: readonly ConnectorSettingDefinition[] = [];

  constructor(private readonly smtpConnector: SmtpConnector) {}

  async send(recipient: string, code: string): Promise<void> {
    const result = await this.smtpConnector.execute({
      declaration: {
        order: OTP_EMAIL_DECLARATION_ORDER,
        config: { templatePath: OTP_EMAIL_TEMPLATE_PATH },
      },
      execution: OTP_EMAIL_EXECUTION,
      context: {},
      payload: { recipient, subject: OTP_EMAIL_SUBJECT, code },
      payloadFieldSources: {},
    });

    if (result.status !== 'accepted') {
      throw new OtpDeliveryFailedException();
    }
  }
}
