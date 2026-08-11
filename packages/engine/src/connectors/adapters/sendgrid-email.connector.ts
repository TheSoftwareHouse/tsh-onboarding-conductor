import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import { AppConfig } from '../../config/app.config';
import { SendgridEmailUnavailableException } from '../errors/sendgrid-email-unavailable.exception';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';

const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class SendgridEmailConnector implements ConnectorAdapter {
  readonly name = 'sendgrid_email';
  readonly type = 'sendgrid_email';

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const recipient = this.getRequiredString(input.payload.recipient);
    const subject = this.getRequiredString(input.payload.subject);
    const body = this.getRequiredString(input.payload.body);

    if (!recipient || !subject || !body) {
      return ConnectorExecutionResult.invalid();
    }

    if (!this.isValidEmail(recipient)) {
      return ConnectorExecutionResult.invalidData(
        { recipient: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      );
    }

    const apiKey = this.configService.getOrThrow<string>('SENDGRID_API_KEY');
    const from = this.configService.getOrThrow<string>('SENDGRID_FROM');

    try {
      sgMail.setApiKey(apiKey);
      await sgMail.send({ to: recipient, from, subject, text: body });
      return ConnectorExecutionResult.accepted();
    } catch {
      throw new SendgridEmailUnavailableException();
    }
  }

  private getRequiredString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    return undefined;
  }

  private isValidEmail(value: string): boolean {
    return VALID_EMAIL_PATTERN.test(value);
  }
}
