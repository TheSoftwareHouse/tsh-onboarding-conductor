import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';

const HEADER_SAFE_VALUE_PATTERN = /^[^\r\n]+$/;
const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 100000;

@Injectable()
export class SmtpMailhogConnector implements ConnectorAdapter {
  readonly name = 'SmtpMailhogConnector';
  readonly type = 'smtp_mailhog';

  constructor(private readonly configService: ConfigService) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const recipient = this.getRequiredString(input.payload.recipient);
    const subject = this.getRequiredString(input.payload.subject);
    const body = this.getRequiredString(input.payload.body);

    const errors: Record<string, readonly string[]> = {};

    if (!this.isValidHeaderSafeValue(recipient) || !this.isValidEmailValue(recipient)) {
      errors.recipient = ['INVALID'];
    }

    if (!this.isValidHeaderSafeValue(subject) || !this.isValidSubject(subject)) {
      errors.subject = ['INVALID'];
    }

    if (!this.isValidBody(body)) {
      errors.body = ['INVALID'];
    }

    if (Object.keys(errors).length > 0) {
      return ConnectorExecutionResult.invalidData(errors, {
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
    }

    const sender = this.getRequiredString(this.configService.get<string>('SMTP_FROM'));
    if (!this.isValidHeaderSafeValue(sender) || !this.isValidEmailValue(sender)) {
      return ConnectorExecutionResult.invalidData(
        { sender: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      );
    }

    const enabled = this.configService.get<boolean>('SMTP_ENABLED');
    if (!enabled) {
      return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
    }

    const host = this.getRequiredString(this.configService.get<string>('SMTP_HOST'));
    const port = this.getRequiredNumber(this.configService.get<number>('SMTP_PORT'));
    const secure = this.configService.get<boolean>('SMTP_SECURE');
    const startTls = this.configService.get<boolean>('SMTP_STARTTLS');
    const timeout = this.getRequiredNumber(this.configService.get<number>('SMTP_TIMEOUT_MS'));

    if (!host || !port || timeout <= 0) {
      return ConnectorExecutionResult.invalidData(
        { smtp: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      );
    }

    const transport = this.createTransporter(host, port, secure, startTls, timeout);

    try {
      const outcome = await transport.sendMail({
        from: sender,
        to: recipient,
        subject,
        text: body,
      });

      if (Array.isArray(outcome.rejected) && outcome.rejected.length > 0) {
        return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
      }

      return ConnectorExecutionResult.accepted();
    } catch {
      return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
    }
  }

  private createTransporter(
    host: string,
    port: number,
    secure: boolean | undefined,
    startTls: boolean | undefined,
    timeout: number,
  ): Transporter {
    const auth = this.createAuthOptions();

    const options: Record<string, unknown> = {
      host,
      port,
      secure: secure === true,
      timeout,
      connectionTimeout: timeout,
    };

    if (secure === false && startTls === true) {
      options.requireTLS = true;
    } else if (secure === false && startTls === false) {
      options.ignoreTLS = true;
    }

    if (auth) {
      options.auth = auth;
    }

    return createTransport(options as never);
  }

  private createAuthOptions(): { user: string; pass: string } | undefined {
    const username = this.configService.get<string>('SMTP_USERNAME');
    const password = this.configService.get<string>('SMTP_PASSWORD');

    if (typeof username === 'string' && username.length > 0 && typeof password === 'string') {
      return { user: username, pass: password };
    }

    return undefined;
  }

  private getRequiredString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    return undefined;
  }

  private getRequiredNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    return undefined;
  }

  private isValidHeaderSafeValue(value: string | undefined): boolean {
    if (!value) {
      return false;
    }

    return HEADER_SAFE_VALUE_PATTERN.test(value);
  }

  private isValidBody(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_BODY_LENGTH;
  }

  private isValidSubject(value: string | undefined): boolean {
    return typeof value === 'string' && value.length <= MAX_SUBJECT_LENGTH;
  }

  private isValidEmailValue(value: string | undefined): boolean {
    return typeof value === 'string' && VALID_EMAIL_PATTERN.test(value);
  }
}
