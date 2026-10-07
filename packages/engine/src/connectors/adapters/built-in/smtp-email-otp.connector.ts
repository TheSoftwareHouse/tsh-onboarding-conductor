import { Injectable } from '@nestjs/common';
import type { OtpChannelName } from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import { OtpDeliveryFailedException } from '../../errors/otp-delivery-failed.exception';
import { OtpChallengesRepository } from '../../otp-challenges.repository';
import { SmtpConnector } from './smtp.connector';
import { BaseOtpConnector } from './otp/base-otp.connector';

export const OTP_EMAIL_SUBJECT = 'Your verification code';
export const OTP_EMAIL_TEMPLATE_PATH = 'built-in/otp-code.html';

/** SMTP ignores the execution identity; the delivery has no onboarding to name. */
const OTP_EMAIL_EXECUTION = { onboardingId: 'otp', stepName: 'otp' } as const;
const OTP_EMAIL_DECLARATION_ORDER = 0;

/**
 * One-time codes by email, handed to `SmtpConnector` with the built-in template. It declares no
 * settings: the SMTP transport and its credentials belong to `smtp`.
 */
@Injectable()
export class SmtpEmailOtpConnector extends BaseOtpConnector {
  readonly id = 'smtp_email_otp';
  readonly name = 'smtp_email_otp';
  readonly channel: OtpChannelName = 'email';

  constructor(
    dataSource: DataSource,
    challenges: OtpChallengesRepository,
    private readonly smtpConnector: SmtpConnector,
  ) {
    super(dataSource, challenges);
  }

  protected async deliver(recipient: string, code: string): Promise<void> {
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
