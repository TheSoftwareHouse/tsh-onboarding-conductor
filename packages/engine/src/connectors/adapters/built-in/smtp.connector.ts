import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { EmailTemplateLoaderService } from '../../../email-templates/email-template-loader.service';
import {
  ConnectorSettingsService,
  type ResolvedConnectorSettings,
} from '../../connector-settings.service';
import type {
  ConnectorAdapter,
  ConnectorExecutionInput,
  ConnectorSettingsSchema,
} from '../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';

const HEADER_SAFE_VALUE_PATTERN = /^[^\r\n]+$/;
const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATE_VARIABLE_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 100000;

/** The environment keys `sendMail` reports as the configuration gap that stopped it. */
export const SMTP_CONFIG_KEYS = {
  from: 'SMTP_FROM',
  enabled: 'SMTP_ENABLED',
  host: 'SMTP_HOST',
  port: 'SMTP_PORT',
  timeout: 'SMTP_TIMEOUT_MS',
} as const;

export type SmtpConfigKey = (typeof SMTP_CONFIG_KEYS)[keyof typeof SMTP_CONFIG_KEYS];

export type SmtpMessage = {
  readonly recipient: string;
  readonly subject: string;
  readonly html: string;
};

/**
 * How one `sendMail` ended: sent, refused for the recipient address, stopped by the operator's
 * configuration (naming the key), or failed in the transport.
 */
export type SmtpSendOutcome =
  | { readonly status: 'sent' }
  | { readonly status: 'invalid_recipient' }
  | { readonly status: 'not_configured'; readonly key: SmtpConfigKey }
  | { readonly status: 'failed' };

@Injectable()
export class SmtpConnector implements ConnectorAdapter {
  readonly name = 'smtp';
  readonly id = 'smtp';
  readonly type = 'email_delivery' as const;

  readonly settingsSchema: ConnectorSettingsSchema = {
    fields: [
      { key: 'username', secret: false, required: false },
      { key: 'password', secret: true, required: false },
    ],
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly emailTemplateLoader: EmailTemplateLoaderService,
    private readonly connectorSettingsService: ConnectorSettingsService,
  ) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const recipient = this.getRequiredString(input.payload.recipient);
    const subject = this.getRequiredString(input.payload.subject);
    const body = this.renderBody(input.declaration.config, input.payload);

    const errors: Record<string, readonly string[]> = {};

    if (!this.isValidHeaderSafeValue(recipient) || !this.isValidEmailValue(recipient)) {
      errors.recipient = ['INVALID'];
    }

    if (!this.isValidHeaderSafeValue(subject) || !this.isValidSubject(subject)) {
      errors.subject = ['INVALID'];
    }

    if (body === undefined) {
      errors.body = ['INVALID'];
    }

    if (Object.keys(errors).length > 0) {
      return ConnectorExecutionResult.invalidData(errors, {
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
    }

    const outcome = await this.sendMail({ recipient, subject, html: body });
    switch (outcome.status) {
      case 'sent':
        return ConnectorExecutionResult.accepted();
      case 'not_configured':
        if (outcome.key === SMTP_CONFIG_KEYS.enabled) {
          return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
        }
        return ConnectorExecutionResult.invalidData(
          { [outcome.key === SMTP_CONFIG_KEYS.from ? 'sender' : 'smtp']: ['INVALID'] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        );
      default:
        return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
    }
  }

  /**
   * Sends one HTML message through the configured transport. A caller that is not a workflow email
   * step — the `smtp_email_otp` connector — uses it to tell a bad address, the operator's gap and a
   * transport failure apart, which `execute`'s connector result cannot.
   */
  async sendMail(message: SmtpMessage): Promise<SmtpSendOutcome> {
    if (
      !this.isValidHeaderSafeValue(message.recipient) ||
      !this.isValidEmailValue(message.recipient)
    ) {
      return { status: 'invalid_recipient' };
    }

    const sender = this.getRequiredString(this.configService.get<string>(SMTP_CONFIG_KEYS.from));
    if (!this.isValidHeaderSafeValue(sender) || !this.isValidEmailValue(sender)) {
      return { status: 'not_configured', key: SMTP_CONFIG_KEYS.from };
    }

    if (!this.configService.get<boolean>(SMTP_CONFIG_KEYS.enabled)) {
      return { status: 'not_configured', key: SMTP_CONFIG_KEYS.enabled };
    }

    const host = this.getRequiredString(this.configService.get<string>(SMTP_CONFIG_KEYS.host));
    const port = this.getRequiredNumber(this.configService.get<number>(SMTP_CONFIG_KEYS.port));
    const secure = this.configService.get<boolean>('SMTP_SECURE');
    const startTls = this.configService.get<boolean>('SMTP_STARTTLS');
    const timeout = this.getRequiredNumber(
      this.configService.get<number>(SMTP_CONFIG_KEYS.timeout),
    );

    if (!host) {
      return { status: 'not_configured', key: SMTP_CONFIG_KEYS.host };
    }
    if (!port) {
      return { status: 'not_configured', key: SMTP_CONFIG_KEYS.port };
    }
    if (!timeout || timeout <= 0) {
      return { status: 'not_configured', key: SMTP_CONFIG_KEYS.timeout };
    }

    const settings = await this.connectorSettingsService.resolve(this);
    const transport = this.createTransporter(host, port, secure, startTls, timeout, settings);

    try {
      const outcome = await transport.sendMail({
        from: sender,
        to: message.recipient,
        subject: message.subject,
        html: message.html,
      });

      return Array.isArray(outcome.rejected) && outcome.rejected.length > 0
        ? { status: 'failed' }
        : { status: 'sent' };
    } catch {
      return { status: 'failed' };
    }
  }

  private createTransporter(
    host: string,
    port: number,
    secure: boolean | undefined,
    startTls: boolean | undefined,
    timeout: number,
    settings: ResolvedConnectorSettings,
  ): Transporter {
    const auth = this.createAuthOptions(settings);

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

  private createAuthOptions(
    settings: ResolvedConnectorSettings,
  ): { user: string; pass: string } | undefined {
    const username = settings.find('username');
    const password = settings.find('password');

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

  /**
   * Renders a body from a declaration's `templatePath` or inline `body.html`, filling its
   * `{{variables}}` from `payload` with HTML escaping; undefined when the template is missing,
   * malformed or names a variable the payload lacks.
   */
  renderBody(
    config: Readonly<Record<string, unknown>>,
    payload: Readonly<Record<string, unknown>>,
  ): string | undefined {
    let template: string | undefined;
    if (typeof config.templatePath === 'string') {
      try {
        template = this.emailTemplateLoader.load(config.templatePath);
      } catch {
        return undefined;
      }
    } else if (this.isRecord(config.body) && typeof config.body.html === 'string') {
      template = config.body.html;
    } else {
      return undefined;
    }

    if (!this.isValidBody(template)) {
      return undefined;
    }

    const variableNames = new Set<string>();
    let lastMatchEnd = 0;

    for (const match of template.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
      const matchStart = match.index ?? 0;
      const literal = template.slice(lastMatchEnd, matchStart);
      if (/[{}]/.test(literal)) {
        return undefined;
      }

      variableNames.add(match[1]);
      lastMatchEnd = matchStart + match[0].length;
    }

    if (/[{}]/.test(template.slice(lastMatchEnd))) {
      return undefined;
    }

    let rendered = template;
    for (const variableName of variableNames) {
      const value = payload[variableName];
      if (typeof value !== 'string' || value.trim().length === 0) {
        return undefined;
      }

      rendered = rendered.replace(new RegExp(`{{\\s*${variableName}\\s*}}`, 'g'), () =>
        this.escapeHtml(value),
      );
    }

    return this.isValidBody(rendered) ? rendered : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character] ?? character,
    );
  }

  private isValidSubject(value: string | undefined): boolean {
    return typeof value === 'string' && value.length <= MAX_SUBJECT_LENGTH;
  }

  private isValidEmailValue(value: string | undefined): boolean {
    return typeof value === 'string' && VALID_EMAIL_PATTERN.test(value);
  }
}
