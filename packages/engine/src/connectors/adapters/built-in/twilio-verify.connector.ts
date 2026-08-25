import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/app.config';
import { ConnectorSettingsService } from '../../connector-settings.service';
import { TwilioVerifyUnavailableException } from '../../errors/twilio-verify-unavailable.exception';
import type {
  ConnectorAdapter,
  ConnectorExecutionInput,
  ConnectorSettingsSchema,
} from '../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';

const TWILIO_VERIFY_BASE_URL = 'https://verify.twilio.com/v2/Services';

export enum TwilioVerifyEndpoint {
  START_VERIFICATION = 'startVerification',
  CHECK_VERIFICATION = 'checkVerification',
}

const TWILIO_VERIFY_ENDPOINT_PATHS: Readonly<Record<TwilioVerifyEndpoint, string>> = {
  [TwilioVerifyEndpoint.START_VERIFICATION]: 'Verifications',
  [TwilioVerifyEndpoint.CHECK_VERIFICATION]: 'VerificationCheck',
};

type TwilioVerifyResponse = Readonly<{
  status?: string;
  valid?: boolean;
  code?: number;
}>;

const HTTP_SUCCESS_UPPER_BOUND = 300;

/** Twilio's own SID format for a Verify Service — carried over from the deleted
 * `TWILIO_VERIFY_SERVICE_SID` env validation so a typo still fails fast. */
const VERIFY_SERVICE_SID_PATTERN = /^VA[A-Za-z0-9]+$/;

export enum TwilioVerifyErrorCode {
  VERIFICATION_NOT_FOUND = 20404,
  MAX_ATTEMPTS_REACHED = 60202,
}

@Injectable()
export class TwilioVerifyConnector implements ConnectorAdapter {
  readonly name = 'twilio_verify';
  readonly type = 'twilio_verify';

  readonly settingsSchema: ConnectorSettingsSchema = {
    fields: [
      { key: 'accountSid', secret: false, required: true },
      { key: 'authToken', secret: true, required: true },
      {
        key: 'verifyServiceSid',
        secret: false,
        required: true,
        pattern: VERIFY_SERVICE_SID_PATTERN,
      },
    ],
  };

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly connectorSettingsService: ConnectorSettingsService,
  ) {}

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
      resolvedOperation === TwilioVerifyEndpoint.CHECK_VERIFICATION
        ? this.resolveCode(input.payload)
        : undefined;

    if (resolvedOperation === TwilioVerifyEndpoint.CHECK_VERIFICATION && !code) {
      return ConnectorExecutionResult.invalid();
    }

    const timeoutMs = this.configService.getOrThrow<number>('TWILIO_VERIFY_TIMEOUT_MS');
    const settings = await this.connectorSettingsService.resolve(this);
    const accountSid = settings.get('accountSid');
    const authToken = settings.get('authToken');
    const verifyServiceSid = settings.get('verifyServiceSid');

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
      const providerResponse = await this.parseResponse(response);
      return this.mapResponse(providerResponse, resolvedOperation, response.status);
    } catch (error) {
      if (error instanceof TwilioVerifyUnavailableException) {
        throw error;
      }

      throw new TwilioVerifyUnavailableException();
    }
  }

  private resolveOperation(
    config: Readonly<Record<string, unknown>>,
  ): TwilioVerifyEndpoint | undefined {
    const operation = config?.operation;
    if (
      typeof operation === 'string' &&
      Object.values(TwilioVerifyEndpoint).includes(operation as TwilioVerifyEndpoint)
    ) {
      return operation as TwilioVerifyEndpoint;
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

  private buildUrl(verifyServiceSid: string, operation: TwilioVerifyEndpoint): string {
    const suffix = TWILIO_VERIFY_ENDPOINT_PATHS[operation];
    return `${TWILIO_VERIFY_BASE_URL}/${verifyServiceSid}/${suffix}`;
  }

  private buildRequestBody(
    operation: TwilioVerifyEndpoint,
    recipient: string,
    code: string | undefined,
  ): string {
    const params = new URLSearchParams();
    params.set('To', recipient);

    if (operation === TwilioVerifyEndpoint.START_VERIFICATION) {
      params.set('Channel', 'sms');
      return params.toString();
    }

    if (code) {
      params.set('Code', code);
    }

    return params.toString();
  }

  private async parseResponse(response: Response): Promise<TwilioVerifyResponse> {
    const responseText = await response.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new TwilioVerifyUnavailableException();
    }

    const parsedObject =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { status?: unknown; valid?: unknown; code?: unknown })
        : {};

    const code = parsedObject.code;

    return {
      status: typeof parsedObject.status === 'string' ? parsedObject.status : undefined,
      valid: typeof parsedObject.valid === 'boolean' ? parsedObject.valid : undefined,
      code: typeof code === 'number' && Number.isFinite(code) ? code : undefined,
    };
  }

  private mapResponse(
    response: TwilioVerifyResponse,
    operation: TwilioVerifyEndpoint,
    httpStatus: number,
  ): ConnectorExecutionResult {
    if (operation === TwilioVerifyEndpoint.START_VERIFICATION) {
      if (httpStatus >= HttpStatus.OK && httpStatus < HTTP_SUCCESS_UPPER_BOUND) {
        return ConnectorExecutionResult.accepted();
      }

      throw new TwilioVerifyUnavailableException();
    }

    if (
      httpStatus === HttpStatus.NOT_FOUND &&
      response.code === TwilioVerifyErrorCode.VERIFICATION_NOT_FOUND
    ) {
      return ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND');
    }

    if (
      httpStatus === HttpStatus.TOO_MANY_REQUESTS &&
      response.code === TwilioVerifyErrorCode.MAX_ATTEMPTS_REACHED
    ) {
      return ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED');
    }

    if (httpStatus < HttpStatus.OK || httpStatus >= HTTP_SUCCESS_UPPER_BOUND) {
      throw new TwilioVerifyUnavailableException();
    }

    const status = response.status?.toLowerCase();
    if (status === 'approved') {
      return ConnectorExecutionResult.accepted();
    }

    if (status === 'invalid' || (status === 'pending' && response.valid === false)) {
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

    if (status === 'missing' || status === 'not_found') {
      return ConnectorExecutionResult.rejected('CHALLENGE_NOT_FOUND');
    }

    if (
      status === 'max_attempts_reached' ||
      status === 'max_attempts_exceeded' ||
      status === 'max_attempts_exhausted'
    ) {
      return ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED');
    }

    if (status === 'denied' || status === 'rejected' || status === 'canceled') {
      return ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
    }

    throw new TwilioVerifyUnavailableException();
  }
}
