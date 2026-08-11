import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NormalizedWorkflowConnectorDeclaration } from '@tsh/ddl-schema';
import { AppConfig } from '../../config/app.config';
import {
  parseHttpConnectorSecrets,
  type HttpConnectorSecrets,
} from '../../config/http-connector-secrets.config';
import { HttpConnectorRequestFailedError } from '../errors/http-connector-request-failed.error';
import type { ConnectorAdapter, ConnectorExecutionInput } from '../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';
import {
  parseHttpConnectorConfig,
  type HttpConnectorConfig,
  type HttpRequestMethod,
} from './http-request/http-request-config';
import { resolveTemplateValue, type TemplateScope } from './http-request/http-request-template';

const BODYLESS_METHODS: readonly HttpRequestMethod[] = ['GET', 'DELETE'];

const GENERIC_ERROR_FIELD = '_connector';
const GENERIC_ERROR_MESSAGE = 'HTTP_CONNECTOR_REQUEST_REJECTED';

type FieldErrors = Readonly<Record<string, readonly string[]>>;

@Injectable()
export class HttpRequestConnector implements ConnectorAdapter {
  readonly name = 'http_request';
  readonly type = 'http_request';

  private readonly logger = new Logger(HttpRequestConnector.name);
  private readonly secrets: HttpConnectorSecrets;
  private readonly defaultTimeoutMs: number;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.secrets = parseHttpConnectorSecrets(
      configService.get<string>('HTTP_CONNECTOR_SECRETS', { infer: true }),
    );
    this.defaultTimeoutMs = configService.getOrThrow<number>('HTTP_CONNECTOR_TIMEOUT_MS');
  }

  validateDeclaration(declaration: NormalizedWorkflowConnectorDeclaration): void {
    parseHttpConnectorConfig(
      {
        context: `connector ${declaration.name}`,
        config: declaration.config,
        fieldMapping: declaration.fieldMapping,
      },
      this.secrets,
    );
  }

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    const config = parseHttpConnectorConfig(
      {
        context: `step ${input.execution.stepName}`,
        config: input.declaration.config,
        fieldMapping: input.payloadFieldSources,
      },
      this.secrets,
    );
    const scope: TemplateScope = {
      payload: input.payload,
      secrets: this.secrets,
      execution: input.execution,
    };

    const { method } = config.request;
    const url = this.buildUrl(config, scope, input.execution.stepName);
    const headers = new Headers();
    const body = this.buildBody(config, scope, input.payload, input.execution.stepName);

    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    for (const [key, value] of Object.entries(config.request.headers)) {
      headers.set(key, this.resolveScalar(value, scope, `header ${key}`, input.execution.stepName));
    }

    this.logger.log(
      `HTTP_CONNECTOR_REQUEST step=${input.execution.stepName} onboardingId=${input.execution.onboardingId} method=${method} urlTemplate=${config.request.url}`,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(config.request.timeoutMs ?? this.defaultTimeoutMs),
      });
    } catch (error) {
      throw new HttpConnectorRequestFailedError(
        input.execution.stepName,
        error instanceof Error ? error.message : 'request could not be sent',
      );
    }

    if (response.ok) {
      return ConnectorExecutionResult.accepted();
    }

    if (
      response.status >= 400 &&
      response.status <= 499 &&
      !config.response.errorStatuses.includes(response.status)
    ) {
      const errors = await this.readFieldErrors(response, config, input.payloadFieldSources);

      return ConnectorExecutionResult.invalidData(errors, {
        [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
      });
    }

    throw new HttpConnectorRequestFailedError(
      input.execution.stepName,
      `unexpected response status ${response.status}`,
    );
  }

  private buildUrl(config: HttpConnectorConfig, scope: TemplateScope, stepName: string): URL {
    const resolvedUrl = this.resolveScalar(config.request.url, scope, 'request.url', stepName);

    let url: URL;
    try {
      url = new URL(resolvedUrl);
    } catch {
      throw new HttpConnectorRequestFailedError(stepName, 'request.url did not resolve to a URL');
    }

    for (const [key, value] of Object.entries(config.request.query)) {
      const resolved = this.resolveValue(value, scope, `request.query.${key}`, stepName);

      if (resolved === undefined || resolved === null) {
        continue;
      }

      if (typeof resolved === 'object') {
        throw new HttpConnectorRequestFailedError(
          stepName,
          `request.query.${key} must resolve to a scalar`,
        );
      }

      url.searchParams.set(key, String(resolved));
    }

    return url;
  }

  private buildBody(
    config: HttpConnectorConfig,
    scope: TemplateScope,
    payload: Readonly<Record<string, unknown>>,
    stepName: string,
  ): string | undefined {
    if (BODYLESS_METHODS.includes(config.request.method)) {
      return undefined;
    }

    if (config.request.body === undefined) {
      return JSON.stringify(payload);
    }

    return JSON.stringify(this.resolveValue(config.request.body, scope, 'request.body', stepName));
  }

  private async readFieldErrors(
    response: Response,
    config: HttpConnectorConfig,
    payloadFieldSources: Readonly<Record<string, string>>,
  ): Promise<FieldErrors> {
    const genericErrors: FieldErrors = { [GENERIC_ERROR_FIELD]: [GENERIC_ERROR_MESSAGE] };

    let parsedBody: unknown;
    try {
      const rawBody = await response.text();

      if (rawBody.trim().length === 0) {
        return genericErrors;
      }

      parsedBody = JSON.parse(rawBody);
    } catch {
      return genericErrors;
    }

    let scoped: unknown = parsedBody;
    for (const segment of config.response.errorsPath.split('.')) {
      if (typeof scoped !== 'object' || scoped === null || Array.isArray(scoped)) {
        return genericErrors;
      }

      scoped = (scoped as Record<string, unknown>)[segment];
    }

    if (typeof scoped !== 'object' || scoped === null || Array.isArray(scoped)) {
      return genericErrors;
    }

    const errors: Record<string, readonly string[]> = {};

    for (const [key, value] of Object.entries(scoped as Record<string, unknown>)) {
      const messages = Array.isArray(value)
        ? value.filter((message): message is string => typeof message === 'string')
        : typeof value === 'string'
          ? [value]
          : [];

      if (messages.length === 0) {
        continue;
      }

      errors[payloadFieldSources[key] ?? key] = messages;
    }

    return Object.keys(errors).length > 0 ? errors : genericErrors;
  }

  private resolveScalar(
    value: string,
    scope: TemplateScope,
    location: string,
    stepName: string,
  ): string {
    const resolved = this.resolveValue(value, scope, location, stepName);

    if (resolved === undefined || resolved === null || typeof resolved === 'object') {
      throw new HttpConnectorRequestFailedError(stepName, `${location} must resolve to a scalar`);
    }

    return String(resolved);
  }

  private resolveValue(
    value: unknown,
    scope: TemplateScope,
    location: string,
    stepName: string,
  ): unknown {
    try {
      return resolveTemplateValue(value, scope);
    } catch (error) {
      throw new HttpConnectorRequestFailedError(
        stepName,
        `${location} could not be resolved: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
