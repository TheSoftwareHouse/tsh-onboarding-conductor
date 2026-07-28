import { randomUUID } from 'node:crypto';
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

type MockCallbackStatus = 'accepted' | 'rejected' | 'invalid' | 'invalid-data';

type StoredInitiation = Readonly<{
  onboardingId: string;
  connectorOrder: number;
}>;

type MockProviderCallbackPayload = Readonly<{
  providerReference: string;
  status?: MockCallbackStatus;
  submittedData: Record<string, unknown>;
  reason?: ConnectorRejectionReason;
  errors?: Record<string, readonly string[]>;
}>;

export type MockAsyncProviderInitiation = Readonly<{
  providerReference: string;
  onboardingId: string;
  connectorOrder: number;
}>;

export type MockAsyncProviderCallbackFixture = Readonly<{
  rawBody: Uint8Array;
  headers: Record<string, string | undefined>;
}>;

@Injectable()
export class MockAsyncCallbackConnector implements ConnectorAdapter {
  readonly name = 'mock_async_callback';
  readonly type = 'mock_async_callback';
  readonly supportsAsyncCallback = true;

  private readonly initiatedRequests = new Map<string, StoredInitiation>();
  private latestInitiation?: MockAsyncProviderInitiation;

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const providerReference = randomUUID();
    this.initiatedRequests.set(providerReference, {
      onboardingId: input.execution.onboardingId,
      connectorOrder: input.declaration.order,
    });
    this.latestInitiation = {
      providerReference,
      onboardingId: input.execution.onboardingId,
      connectorOrder: input.declaration.order,
    };

    return ConnectorExecutionResult.accepted();
  }

  getLatestInitiation(): MockAsyncProviderInitiation | undefined {
    if (!this.latestInitiation) {
      return undefined;
    }

    return {
      providerReference: this.latestInitiation.providerReference,
      onboardingId: this.latestInitiation.onboardingId,
      connectorOrder: this.latestInitiation.connectorOrder,
    };
  }

  emitProviderCallback(input: {
    providerReference: string;
    submittedData: Record<string, unknown>;
    status?: MockCallbackStatus;
    reason?: ConnectorRejectionReason;
    errors?: Record<string, readonly string[]>;
    headers?: Readonly<Record<string, string | undefined>>;
  }): MockAsyncProviderCallbackFixture {
    const payload: Record<string, unknown> = {
      providerReference: this.requireNonEmptyText(
        input.providerReference,
        'providerReference must be a non-empty string',
      ),
      submittedData: this.requireSubmittedData(input.submittedData),
      status: input.status ?? 'accepted',
    };

    if (input.reason !== undefined) {
      payload.reason = this.optionalRejectionReason(input.reason);
    }

    if (input.errors !== undefined) {
      payload.errors = this.optionalErrors(input.errors);
    }

    return {
      rawBody: new TextEncoder().encode(JSON.stringify(payload)),
      headers: { ...(input.headers ?? {}) },
    };
  }

  async mapCallbackResult(input: ConnectorCallbackMappingInput): Promise<ConnectorCallbackResult> {
    if (input.rawBody.byteLength === 0) {
      throw new Error('Callback body is required');
    }

    const payload = this.parsePayload(input.rawBody);
    const storedInitiation = this.initiatedRequests.get(payload.providerReference);

    if (!storedInitiation) {
      throw new Error('Unknown provider reference');
    }

    return {
      onboardingId: storedInitiation.onboardingId,
      submittedData: payload.submittedData,
      resolvedConnector: {
        connectorOrder: storedInitiation.connectorOrder,
      },
      result: this.buildResult(payload),
    };
  }

  private buildResult(payload: MockProviderCallbackPayload): ConnectorExecutionResult {
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

  private parsePayload(rawBody: Uint8Array): MockProviderCallbackPayload {
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

    if (
      Object.prototype.hasOwnProperty.call(parsedRecord, 'onboardingId') ||
      Object.prototype.hasOwnProperty.call(parsedRecord, 'connectorOrder')
    ) {
      throw new Error('Callback payload contains forbidden correlation fields');
    }

    const providerReference = this.requireNonEmptyText(
      parsedRecord.providerReference,
      'providerReference must be a non-empty string',
    );
    const submittedData = this.requireSubmittedData(parsedRecord.submittedData);

    return {
      providerReference,
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

  private requireSubmittedData(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('submittedData must be an object');
    }

    return { ...(value as Record<string, unknown>) };
  }

  private optionalStatus(value: unknown): MockProviderCallbackPayload['status'] {
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
