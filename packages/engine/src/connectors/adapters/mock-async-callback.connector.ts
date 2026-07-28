import { Injectable } from '@nestjs/common';
import type {
  ConnectorAdapter,
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
} from '../ports/connector-adapter.port';
import {
  type ConnectorCallbackResult,
  type ConnectorRejectionReason,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';

type MockCallbackPayload = Readonly<{
  onboardingId: string;
  connectorOrder: number;
  submittedData: Record<string, unknown>;
  status?: 'accepted' | 'rejected' | 'invalid' | 'invalid-data';
  reason?: ConnectorRejectionReason;
  errors?: Record<string, readonly string[]>;
}>;

@Injectable()
export class MockAsyncCallbackConnector implements ConnectorAdapter {
  readonly name = 'mock_async_callback';
  readonly type = 'mock_async_callback';
  readonly supportsAsyncCallback = true;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    return ConnectorExecutionResult.invalid();
  }

  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    if (input.connectorType !== this.type) {
      throw new Error(`Unsupported connector type=${input.connectorType}`);
    }

    if (input.providerKey !== this.type) {
      throw new Error(`Unsupported provider key=${input.providerKey}`);
    }

    if (input.rawBody.byteLength === 0) {
      throw new Error('Callback body is required');
    }

    const payload = this.parsePayload(input.rawBody);

    return {
      onboardingId: payload.onboardingId,
      submittedData: payload.submittedData,
      resolvedConnector: {
        connectorOrder: payload.connectorOrder,
      },
      result: this.buildResult(payload),
    };
  }

  private buildResult(payload: MockCallbackPayload): ConnectorExecutionResult {
    switch (payload.status) {
      case 'rejected':
        return ConnectorExecutionResult.rejected(payload.reason ?? 'CONNECTOR_REJECTED');
      case 'invalid':
        return ConnectorExecutionResult.invalid();
      case 'invalid-data':
        return ConnectorExecutionResult.invalidData(payload.errors ?? {});
      case 'accepted':
      default:
        return ConnectorExecutionResult.accepted();
    }
  }

  private parsePayload(rawBody: Uint8Array): MockCallbackPayload {
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    } catch {
      throw new Error('Callback body must be valid UTF-8');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error('Callback body must be valid JSON');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Callback JSON body must be an object');
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const onboardingId = this.requireNonEmptyText(
      parsedRecord.onboardingId,
      'onboardingId must be a non-empty string',
    );
    const connectorOrder = this.requireConnectorOrder(parsedRecord.connectorOrder);
    const submittedData = this.requireSubmittedData(parsedRecord.submittedData);

    return {
      onboardingId,
      connectorOrder,
      submittedData,
      status: this.optionalStatus(parsedRecord.status),
      reason: this.optionalRejectionReason(parsedRecord.reason),
      errors: this.optionalErrors(parsedRecord.errors),
    };
  }

  private requireNonEmptyText(value: unknown, message: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(message);
    }

    return value.trim();
  }

  private requireConnectorOrder(value: unknown): number {
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw new Error('connectorOrder must be a positive integer');
    }

    return value as number;
  }

  private requireSubmittedData(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('submittedData must be an object');
    }

    return { ...(value as Record<string, unknown>) };
  }

  private optionalStatus(value: unknown): MockCallbackPayload['status'] {
    if (value === undefined) {
      return undefined;
    }

    if (
      value === 'accepted' ||
      value === 'rejected' ||
      value === 'invalid' ||
      value === 'invalid-data'
    ) {
      return value;
    }

    throw new Error('status must be one of accepted, rejected, invalid, invalid-data');
  }

  private optionalRejectionReason(value: unknown): ConnectorRejectionReason | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      value === 'ATTEMPTS_EXHAUSTED' ||
      value === 'CHALLENGE_EXPIRED' ||
      value === 'CHALLENGE_NOT_FOUND' ||
      value === 'CONNECTOR_REJECTED'
    ) {
      return value;
    }

    throw new Error('reason must be a valid ConnectorRejectionReason');
  }

  private optionalErrors(value: unknown): Record<string, readonly string[]> | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('errors must be an object');
    }

    const errors = value as Record<string, unknown>;
    const normalized: Record<string, readonly string[]> = {};

    for (const [key, errorValue] of Object.entries(errors)) {
      if (Array.isArray(errorValue) && errorValue.every((item) => typeof item === 'string')) {
        normalized[key] = errorValue as readonly string[];
      } else {
        throw new Error(`errors.${key} must be an array of strings`);
      }
    }

    return normalized;
  }
}
