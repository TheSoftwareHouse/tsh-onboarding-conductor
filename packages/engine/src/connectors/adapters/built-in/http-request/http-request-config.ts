import type { HttpConnectorSecrets } from './http-request-secrets';
import { HttpConnectorConfigInvalidError } from '../../../errors/http-connector-config-invalid.error';
import { ConnectorNotConfiguredException } from '../../../errors/connector-not-configured.exception';
import { collectTemplateReferences, resolveTemplateValue } from './http-request-template';

/** The `ConnectorNotConfiguredException` connector type for every `http_request` declaration. */
const HTTP_REQUEST_CONNECTOR_TYPE = 'http_request';

/**
 * Stands in for a secret placeholder's real value when only the declaration's *shape* is being
 * checked — `'shape'` mode never asserts presence. Looks like an absolute origin so a URL built
 * entirely from a secret (`{{secrets.provider.baseUrl}}/v1/customers`) still resolves to a valid
 * absolute URL for `assertUrlAbsolute`, the same way a literal `'probe'` already does for a
 * payload key embedded in a path segment.
 */
const SECRET_PROBE_VALUE = 'https://secret-probe.invalid';

/**
 * Distinguishes the two moments `parseHttpConnectorConfig` is called at. `'shape'` — workflow
 * load time — checks placeholder syntax and payload/execution references exactly as `'resolved'`
 * does, but only checks a `secrets.*` reference for well-formedness, not presence: whether a
 * stored or environment value actually exists for it is no longer knowable at boot once secrets
 * can arrive at runtime. `'resolved'` — execution time — asserts presence against the merged
 * secrets and raises `ConnectorNotConfiguredException` for one that resolves nowhere, because an
 * absent credential is an operator's gap, not an invalid workflow.
 */
export type HttpConnectorParseMode = 'shape' | 'resolved';

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
  mode: HttpConnectorParseMode,
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

    if (reference.root === 'secrets' && mode === 'resolved') {
      const [alias, key] = reference.path;

      if (!secrets[alias] || !Object.prototype.hasOwnProperty.call(secrets[alias], key)) {
        throw new ConnectorNotConfiguredException(HTTP_REQUEST_CONNECTOR_TYPE, `${alias}.${key}`);
      }
    }
  }
};

/**
 * Every secret placeholder in `url`, mapped to `SECRET_PROBE_VALUE` — never the real secrets —
 * so `assertUrlAbsolute` can prove the URL's shape without needing (`'shape'` mode) or trusting
 * (`'resolved'` mode, where presence was already asserted) the configured value.
 */
const buildProbeSecrets = (url: string): HttpConnectorSecrets => {
  const probe: Record<string, Record<string, string>> = {};

  for (const reference of collectTemplateReferences(url)) {
    if (reference.root === 'secrets') {
      const [alias, key] = reference.path;
      probe[alias] = { ...probe[alias], [key]: SECRET_PROBE_VALUE };
    }
  }

  return probe;
};

const assertUrlAbsolute = (
  url: string,
  declaration: HttpConnectorDeclaration,
  fail: (reason: string) => never,
): void => {
  const probePayload = Object.fromEntries(
    Object.keys(declaration.fieldMapping).map((payloadKey) => [payloadKey, 'probe']),
  );
  const probeUrl = resolveTemplateValue(url, {
    payload: probePayload,
    secrets: buildProbeSecrets(url),
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
  mode: HttpConnectorParseMode = 'resolved',
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
    assertReferencesResolvable(config, declaration, secrets, mode, fail);
  } catch (error) {
    if (
      error instanceof HttpConnectorConfigInvalidError ||
      error instanceof ConnectorNotConfiguredException
    ) {
      throw error;
    }

    fail(error instanceof Error ? error.message : 'invalid placeholder');
  }

  assertUrlAbsolute(config.request.url, declaration, fail);

  return config;
}
