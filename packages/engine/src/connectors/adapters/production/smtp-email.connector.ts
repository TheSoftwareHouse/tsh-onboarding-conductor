import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import {
  BUILT_IN_WORKFLOWS_DIR,
  FIXTURE_WORKFLOWS_DIR,
} from '../../../config/workflow-directories';
import { SmtpEmailUnavailableException } from '../../errors/smtp-email-unavailable.exception';
import { ConnectorTier } from '../../ports/connector-adapter.port';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';

const HEADER_SAFE_VALUE_PATTERN = /^[^\r\n]+$/;
const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATE_VARIABLE_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 100000;

@Injectable()
export class SmtpEmailConnector implements ConnectorAdapter {
  readonly name = 'smtp_email';
  readonly type = 'smtp_email';
  readonly tier = ConnectorTier.PRODUCTION;

  constructor(private readonly configService: ConfigService) {}

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

    // Operator misconfiguration is never the applicant's fault: surface it as an outage so the
    // step stays retryable, instead of rejecting the onboarding or blaming a submitted field.
    const sender = this.getRequiredString(this.configService.get<string>('SMTP_FROM'));
    if (!this.isValidHeaderSafeValue(sender) || !this.isValidEmailValue(sender)) {
      throw new SmtpEmailUnavailableException();
    }

    const enabled = this.configService.get<boolean>('SMTP_ENABLED');
    if (!enabled) {
      throw new SmtpEmailUnavailableException();
    }

    const host = this.getRequiredString(this.configService.get<string>('SMTP_HOST'));
    const port = this.getRequiredNumber(this.configService.get<number>('SMTP_PORT'));
    const secure = this.configService.get<boolean>('SMTP_SECURE');
    const startTls = this.configService.get<boolean>('SMTP_STARTTLS');
    const timeout = this.getRequiredNumber(this.configService.get<number>('SMTP_TIMEOUT_MS'));

    if (!host || !port || timeout === undefined || timeout <= 0) {
      throw new SmtpEmailUnavailableException();
    }

    const transport = this.createTransporter(host, port, secure, startTls, timeout);

    let outcome: Awaited<ReturnType<Transporter['sendMail']>>;

    try {
      outcome = await transport.sendMail({
        from: sender,
        to: recipient,
        subject,
        html: body,
      });
    } catch {
      // Connection resets, timeouts and auth failures are transient from the workflow's point of
      // view. Rejecting here would terminate the onboarding on a network blip.
      throw new SmtpEmailUnavailableException();
    }

    // A recipient the server refused outright is a genuine per-recipient rejection.
    if (Array.isArray(outcome.rejected) && outcome.rejected.length > 0) {
      return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
    }

    return ConnectorExecutionResult.accepted();
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

  /**
   * A templatePath is relative to the workflow directory that declared it, but a connector is not
   * told which of the three sources its workflow came from, so each configured source is tried in
   * turn. Paths that resolve outside a source directory are refused rather than read.
   */
  private readTemplate(templatePath: string): string | undefined {
    // Mirrors the sources the registry actually loaded: the fixture directory ships with the
    // package but is off-limits unless fixtures are enabled, so a production workflow cannot
    // reach a template inside it.
    const userDir = this.configService.get<string>('WORKFLOWS_DIR');
    const fixturesEnabled = this.configService.get<boolean>('FIXTURE_WORKFLOWS_ENABLED') === true;
    const sourceDirs = [
      BUILT_IN_WORKFLOWS_DIR,
      userDir,
      fixturesEnabled ? FIXTURE_WORKFLOWS_DIR : undefined,
    ].filter((dir): dir is string => typeof dir === 'string' && dir.trim().length > 0);

    for (const sourceDir of sourceDirs) {
      const root = resolve(sourceDir.trim());
      const candidate = resolve(root, templatePath);

      if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
        continue;
      }

      try {
        return readFileSync(candidate, 'utf8');
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private renderBody(
    config: Readonly<Record<string, unknown>>,
    payload: Readonly<Record<string, unknown>>,
  ): string | undefined {
    let template: string | undefined;
    if (typeof config.templatePath === 'string') {
      template = this.readTemplate(config.templatePath);

      if (template === undefined) {
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
