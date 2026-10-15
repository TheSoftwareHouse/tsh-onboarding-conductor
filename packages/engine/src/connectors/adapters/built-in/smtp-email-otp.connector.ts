import { Injectable } from '@nestjs/common';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { ConnectorNotConfiguredException } from '../../errors/connector-not-configured.exception';
import { OtpDeliveryFailedException } from '../../errors/otp-delivery-failed.exception';
import { OtpChallengesConnection } from '../../otp-challenges.connection';
import { OtpChallengesRepository } from '../../otp-challenges.repository';
import { SmtpConnector } from './smtp.connector';
import {
  BaseOtpConnector,
  OTP_DELIVERY_OUTCOMES,
  type OtpDeliveryOutcome,
} from './otp/base-otp.connector';

export const OTP_EMAIL_SUBJECT = 'Your verification code';
export const OTP_EMAIL_TEMPLATE_PATH = 'built-in/otp-code.html';

/**
 * One-time codes by email, sent through `SmtpConnector.sendMail` with the built-in template. It
 * declares no settings: the SMTP transport and its credentials belong to `smtp`.
 */
@Injectable()
export class SmtpEmailOtpConnector extends BaseOtpConnector {
  readonly id = 'smtp_email_otp';
  readonly name = 'smtp_email_otp';
  readonly channel: OtpChannelName = 'email';

  constructor(
    connection: OtpChallengesConnection,
    challenges: OtpChallengesRepository,
    private readonly smtpConnector: SmtpConnector,
  ) {
    super(connection, challenges);
  }

  protected async deliver(recipient: string, code: string): Promise<OtpDeliveryOutcome> {
    const html = this.smtpConnector.renderBody({ templatePath: OTP_EMAIL_TEMPLATE_PATH }, { code });
    if (html === undefined) {
      // The built-in template is part of the image; failing to render it is the engine's fault.
      throw new OtpDeliveryFailedException();
    }

    const outcome = await this.smtpConnector.sendMail({
      recipient,
      subject: OTP_EMAIL_SUBJECT,
      html,
    });
    switch (outcome.status) {
      case 'sent':
        return OTP_DELIVERY_OUTCOMES.delivered;
      case 'invalid_recipient':
        return OTP_DELIVERY_OUTCOMES.invalidRecipient;
      case 'not_configured':
        throw new ConnectorNotConfiguredException(this.smtpConnector.id, outcome.key);
      default:
        throw new OtpDeliveryFailedException();
    }
  }
}
