import type { HttpConnectorSecrets } from '../../../../config/http-connector-secrets.config';
import { HttpConnectorConfigInvalidError } from '../../../errors/http-connector-config-invalid.error';
import { collectTemplateReferences, resolveTemplateValue } from './http-request-template';

export const HTTP_REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type HttpRequestMethod = (typeof HTTP_REQUEST_METHODS)[number];

const BODYLESS_METHODS: readonly HttpRequestMethod[] = ['GET', 'DELETE'];

const TIMEOUT_MS_MIN = 100;
const TIMEOUT_MS_MAX = 30000;

const DEFAULT_ERRORS_PATH = 'errors';

export type HttpRequestConfig = {
  readonly method: HttpRequestMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
};

export type HttpResponseConfig = {
  readonly errorsPath: string;
  readonly errorStatuses: readonly number[];
};

export type HttpConnectorConfig = {
  readonly request: HttpRequestConfig;
  readonly response: HttpResponseConfig;
};

/**
 * Structural subset of a connector declaration. A normalized workflow declaration satisfies it at
 * workflow-load time; at execution time the adapter rebuilds it from the executor's payload field
 * sources, which carry the same payload-key-to-workflow-field mapping.
 */
export type HttpConnectorDeclaration = {
  readonly context: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly fieldMapping: Readonly<Record<string, string>>;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }

  return false;
};

const isHttpRequestMethod = (value: unknown): value is HttpRequestMethod =>
  typeof value === 'string' && (HTTP_REQUEST_METHODS as readonly string[]).includes(value);

const parseStringMap = (
  value: unknown,
  section: string,
  fail: (reason: string) => never,
): Readonly<Record<string, string>> => {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    fail(`request.${section} must be an object`);
  }

  const entries: Record<string, string> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (key.trim().length === 0) {
      fail(`request.${section} keys must be non-empty`);
    }

    if (typeof entryValue !== 'string') {
      fail(`request.${section}.${key} must be a string`);
    }

    entries[key] = entryValue;
  }

  return entries;
};

const parseResponseConfig = (
  value: unknown,
  fail: (reason: string) => never,
): HttpResponseConfig => {
  if (value === undefined) {
    return { errorsPath: DEFAULT_ERRORS_PATH, errorStatuses: [] };
  }

  if (!isPlainObject(value)) {
    fail('response must be an object');
  }

  const { errorsPath, errorStatuses } = value;

  if (errorsPath !== undefined && (typeof errorsPath !== 'string' || errorsPath.trim() === '')) {
    fail('response.errorsPath must be a non-empty string');
  }

  if (errorStatuses !== undefined && !Array.isArray(errorStatuses)) {
    fail('response.errorStatuses must be an array');
  }

  const parsedErrorStatuses = (errorStatuses ?? []) as unknown[];

  for (const status of parsedErrorStatuses) {
    if (!Number.isInteger(status) || (status as number) < 400 || (status as number) > 499) {
      fail('response.errorStatuses must contain 4xx status codes only');
    }
  }

  return {
    errorsPath: (errorsPath as string | undefined) ?? DEFAULT_ERRORS_PATH,
    errorStatuses: parsedErrorStatuses as readonly number[],
  };
};

const assertReferencesResolvable = (
  config: HttpConnectorConfig,
  declaration: HttpConnectorDeclaration,
  secrets: HttpConnectorSecrets,
  fail: (reason: string) => never,
): void => {
  const references = [
    config.request.url,
    config.request.headers,
    config.request.query,
    config.request.body,
  ].flatMap((section) => collectTemplateReferences(section));

  for (const reference of references) {
    if (
      reference.root === 'payload' &&
      !Object.prototype.hasOwnProperty.call(declaration.fieldMapping, reference.path[0])
    ) {
      fail(
        `placeholder "{{${reference.expression}}}" references a payload key that is missing from fieldMapping`,
      );
    }

    if (reference.root === 'secrets') {
      const [alias, key] = reference.path;

      if (!secrets[alias] || !Object.prototype.hasOwnProperty.call(secrets[alias], key)) {
        fail(
          `placeholder "{{${reference.expression}}}" references a secret that is missing from HTTP_CONNECTOR_SECRETS`,
        );
      }
    }
  }
};

const assertUrlAbsolute = (
  url: string,
  declaration: HttpConnectorDeclaration,
  secrets: HttpConnectorSecrets,
  fail: (reason: string) => never,
): void => {
  const probePayload = Object.fromEntries(
    Object.keys(declaration.fieldMapping).map((payloadKey) => [payloadKey, 'probe']),
  );
  const probeUrl = resolveTemplateValue(url, {
    payload: probePayload,
    secrets,
    execution: { onboardingId: 'probe', stepName: 'probe' },
  });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(String(probeUrl));
  } catch {
    fail('request.url must resolve to an absolute URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    fail('request.url must use the http or https protocol');
  }
};

export function parseHttpConnectorConfig(
  declaration: HttpConnectorDeclaration,
  secrets: HttpConnectorSecrets,
): HttpConnectorConfig {
  const fail: (reason: string) => never = (reason) => {
    throw new HttpConnectorConfigInvalidError(declaration.context, reason);
  };

  const { request, response, ...unknownSections } = declaration.config;

  const unknownSectionNames = Object.keys(unknownSections);
  if (unknownSectionNames.length > 0) {
    fail(`unknown config section(s): ${unknownSectionNames.sort().join(', ')}`);
  }

  if (!isPlainObject(request)) {
    fail('request must be an object');
  }

  const { method, url, headers, query, body, timeoutMs, ...unknownRequestKeys } = request;

  const unknownRequestKeyNames = Object.keys(unknownRequestKeys);
  if (unknownRequestKeyNames.length > 0) {
    fail(`unknown request key(s): ${unknownRequestKeyNames.sort().join(', ')}`);
  }

  if (!isHttpRequestMethod(method)) {
    fail(`request.method must be one of ${HTTP_REQUEST_METHODS.join(', ')}`);
  }

  if (typeof url !== 'string' || url.trim() === '') {
    fail('request.url must be a non-empty string');
  }

  if (body !== undefined) {
    if (BODYLESS_METHODS.includes(method)) {
      fail(`request.body is not allowed for method ${method}`);
    }

    if (!isJsonValue(body)) {
      fail('request.body must be a JSON-compatible value');
    }
  }

  if (timeoutMs !== undefined) {
    if (!Number.isInteger(timeoutMs)) {
      fail('request.timeoutMs must be an integer');
    }

    if ((timeoutMs as number) < TIMEOUT_MS_MIN || (timeoutMs as number) > TIMEOUT_MS_MAX) {
      fail(`request.timeoutMs must be between ${TIMEOUT_MS_MIN} and ${TIMEOUT_MS_MAX}`);
    }
  }

  const config: HttpConnectorConfig = {
    request: {
      method,
      url: url as string,
      headers: parseStringMap(headers, 'headers', fail),
      query: parseStringMap(query, 'query', fail),
      body,
      timeoutMs: timeoutMs as number | undefined,
    },
    response: parseResponseConfig(response, fail),
  };

  try {
    assertReferencesResolvable(config, declaration, secrets, fail);
  } catch (error) {
    if (error instanceof HttpConnectorConfigInvalidError) {
      throw error;
    }

    fail(error instanceof Error ? error.message : 'invalid placeholder');
  }

  assertUrlAbsolute(config.request.url, declaration, secrets, fail);

  return config;
}
