import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import { TwilioVerifyUnavailableException } from '../errors/twilio-verify-unavailable.exception';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';

const TWILIO_VERIFY_BASE_URL = 'https://verify.twilio.com/v2/Services';

type TwilioVerifyOperation = 'startVerification' | 'checkVerification';

type TwilioVerifyResponse = Readonly<{
  status?: string;
  valid?: boolean;
}>;

@Injectable()
export class TwilioVerifyConnector implements ConnectorAdapter {
  readonly name = 'twilio_verify';
  readonly type = 'twilio_verify';

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const resolvedOperation = this.resolveOperation(input.declaration.config);
    if (!resolvedOperation) {
      return ConnectorExecutionResult.invalid();
    }

    const recipient = this.resolveRecipient(input.payload);
    if (!recipient) {
      return ConnectorExecutionResult.invalid();
    }

    const code =
      resolvedOperation === 'checkVerification' ? this.resolveCode(input.payload) : undefined;

    if (resolvedOperation === 'checkVerification' && !code) {
      return ConnectorExecutionResult.invalid();
    }

    const timeoutMs = this.configService.getOrThrow<number>('TWILIO_VERIFY_TIMEOUT_MS');
    const accountSid = this.configService.getOrThrow<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.getOrThrow<string>('TWILIO_AUTH_TOKEN');
    const verifyServiceSid = this.configService.getOrThrow<string>('TWILIO_VERIFY_SERVICE_SID');

    const url = this.buildUrl(verifyServiceSid, resolvedOperation);
    const body = this.buildRequestBody(resolvedOperation, recipient, code);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal:
          typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
      });

      if (!response.ok) {
        throw new Error('non-ok response');
      }

      const providerResponse = await this.parseResponse(response);
      return this.mapResponse(providerResponse, resolvedOperation);
    } catch (error) {
      if (error instanceof TwilioVerifyUnavailableException) {
        throw error;
      }

      throw new TwilioVerifyUnavailableException();
    }
  }

  private resolveOperation(
    config: Readonly<Record<string, unknown>>,
  ): TwilioVerifyOperation | undefined {
    const operation = config?.operation;
    if (operation === 'startVerification' || operation === 'checkVerification') {
      return operation;
    }

    return undefined;
  }

  private resolveRecipient(payload: Readonly<Record<string, unknown>>): string | undefined {
    const recipient = payload?.recipient;
    if (typeof recipient !== 'string' || recipient.trim() === '') {
      return undefined;
    }

    return recipient;
  }

  private resolveCode(payload: Readonly<Record<string, unknown>>): string | undefined {
    const code = payload?.code;
    if (typeof code !== 'string' || code.trim() === '') {
      return undefined;
    }

    return code;
  }

  private buildUrl(verifyServiceSid: string, operation: TwilioVerifyOperation): string {
    const suffix = operation === 'startVerification' ? 'Verifications' : 'VerificationChecks';
    return `${TWILIO_VERIFY_BASE_URL}/${verifyServiceSid}/${suffix}`;
  }

  private buildRequestBody(
    operation: TwilioVerifyOperation,
    recipient: string,
    code: string | undefined,
  ): string {
    const params = new URLSearchParams();
    params.set('To', recipient);

    if (operation === 'startVerification') {
      params.set('Channel', 'sms');
      return params.toString();
    }

    if (code) {
      params.set('Code', code);
    }

    return params.toString();
  }

  private async parseResponse(response: Response): Promise<TwilioVerifyResponse> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(await response.text());
    } catch {
      parsed = {};
    }

    const parsedObject =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { status?: unknown; valid?: unknown })
        : {};

    return {
      status: typeof parsedObject.status === 'string' ? parsedObject.status : undefined,
      valid: typeof parsedObject.valid === 'boolean' ? parsedObject.valid : undefined,
    };
  }

  private mapResponse(
    response: TwilioVerifyResponse,
    operation: TwilioVerifyOperation,
  ): ConnectorExecutionResult {
    if (operation === 'startVerification') {
      return ConnectorExecutionResult.accepted();
    }

    const status = response.status?.toLowerCase();
    if (status === 'approved') {
      return ConnectorExecutionResult.accepted();
    }

    if ((status === 'pending' && response.valid === false) || status === 'invalid') {
      return ConnectorExecutionResult.invalidData(
        { verificationCode: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      );
    }

    if (status === 'expired') {
      return ConnectorExecutionResult.rejected('CHALLENGE_EXPIRED');
    }

    if (status === 'not_found' || status === 'missing') {
      return ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND');
    }

    if (status === 'max_attempts_exceeded' || status === 'max_attempts_exhausted') {
      return ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED');
    }

    if (status === 'canceled' || status === 'denied' || status === 'rejected') {
      return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
    }

    throw new TwilioVerifyUnavailableException();
  }
}
