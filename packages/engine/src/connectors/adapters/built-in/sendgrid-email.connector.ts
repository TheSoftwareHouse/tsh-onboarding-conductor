import { Injectable } from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import { ConnectorSettingsService } from '../../connector-settings.service';
import { SendgridEmailUnavailableException } from '../../errors/sendgrid-email-unavailable.exception';
import type {
  ConnectorAdapter,
  ConnectorExecutionInput,
  ConnectorSettingsSchema,
} from '../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';

const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class SendgridEmailConnector implements ConnectorAdapter {
  readonly name = 'sendgrid_email';
  readonly type = 'sendgrid_email';

  readonly settingsSchema: ConnectorSettingsSchema = {
    fields: [
      { key: 'apiKey', secret: true, required: true },
      { key: 'from', secret: false, required: true, pattern: VALID_EMAIL_PATTERN },
    ],
  };

  constructor(private readonly connectorSettingsService: ConnectorSettingsService) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const recipient = this.getRequiredString(input.payload.recipient);
    const templateId = this.getRequiredString(input.payload.templateId);

    if (!recipient || !templateId) {
      return ConnectorExecutionResult.invalid();
    }

    const dynamicTemplateData = this.getDynamicTemplateData(input.payload);

    if (!dynamicTemplateData) {
      return ConnectorExecutionResult.invalid();
    }

    const invalidDataErrors: Record<string, string[]> = {};

    if (!this.isValidEmail(recipient)) {
      invalidDataErrors.recipient = ['INVALID'];
    }

    if (!this.isValidTemplateId(templateId)) {
      invalidDataErrors.templateId = ['INVALID'];
    }

    if (Object.keys(invalidDataErrors).length > 0) {
      return ConnectorExecutionResult.invalidData(invalidDataErrors, {
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
    }

    const settings = await this.connectorSettingsService.resolve(this);
    const apiKey = settings.get('apiKey');
    const from = settings.get('from');

    try {
      sgMail.setApiKey(apiKey);
      await sgMail.send({
        to: recipient,
        from,
        templateId,
        ...(Object.keys(dynamicTemplateData).length > 0 ? { dynamicTemplateData } : {}),
      });
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

  private getDynamicTemplateData(
    payload: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const dynamicTemplateData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (!key.startsWith('dynamicTemplateData.')) {
        if (key === 'dynamicTemplateData') {
          return undefined;
        }
        continue;
      }

      const suffix = key.slice('dynamicTemplateData.'.length).trim();

      if (!suffix || suffix.includes('.')) {
        return undefined;
      }

      const normalizedValue = this.getDynamicTemplateValue(value);

      if (normalizedValue === undefined) {
        return undefined;
      }

      dynamicTemplateData[suffix] = normalizedValue;
    }

    return dynamicTemplateData;
  }

  private getDynamicTemplateValue(value: unknown): unknown | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === 'string') {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return undefined;
      }

      return trimmedValue;
    }

    return value;
  }

  private isValidEmail(value: string): boolean {
    return VALID_EMAIL_PATTERN.test(value);
  }

  private isValidTemplateId(value: string): boolean {
    return value.startsWith('d-');
  }
}
