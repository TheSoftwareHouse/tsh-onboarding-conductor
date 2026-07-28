import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import type { ConnectorAdapter } from '../connectors/ports/connector-adapter.port';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';

export type NormalizedAsyncCallback = Readonly<{
  onboardingId: string;
  submittedData: unknown;
  resolvedConnector: Readonly<{
    connectorOrder: number;
    result: ConnectorExecutionResult;
  }>;
}>;

@Injectable()
export class AsyncConnectorCallbacksService {
  constructor(
    @Optional()
    @Inject(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)
    private readonly connectorExecutionPort?: ConnectorExecutionPort,
  ) {}

  async normalizeInboundCallback(
    _manager: EntityManager,
    input: Readonly<{
      providerKey: string;
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string | undefined>>;
    }>,
  ): Promise<NormalizedAsyncCallback> {
    const adapter = this.resolveRegisteredCallbackAdapter(input.providerKey);
    const normalizedHeaders = this.normalizeHeaders(input.headers);

    const mappedResult = await adapter.mapCallbackResult({
      rawBody: input.rawBody,
      headers: normalizedHeaders,
    });

    return {
      onboardingId: mappedResult.onboardingId,
      submittedData: mappedResult.submittedData,
      resolvedConnector: {
        connectorOrder: mappedResult.resolvedConnector.connectorOrder,
        result: mappedResult.result,
      },
    };
  }

  private assertValidProviderKey(providerKey: string): void {
    if (!/^[a-z0-9_]+$/.test(providerKey)) {
      throw new BadRequestException({
        code: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
        message: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
      });
    }
  }

  private resolveRegisteredCallbackAdapter(
    providerKey: string,
  ): Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> & ConnectorAdapter {
    this.assertValidProviderKey(providerKey);

    if (!this.connectorExecutionPort?.resolveAsyncCallbackAdapterByType) {
      throw new BadRequestException({
        code: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
        message: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
      });
    }

    try {
      return this.connectorExecutionPort.resolveAsyncCallbackAdapterByType(providerKey);
    } catch {
      throw new BadRequestException({
        code: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
        message: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
      });
    }
  }

  private normalizeHeaders(
    headers: Readonly<Record<string, string | undefined>>,
  ): Record<string, string | undefined> {
    const normalized: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }

    return normalized;
  }
}
