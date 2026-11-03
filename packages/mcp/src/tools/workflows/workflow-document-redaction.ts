import { isJsonObject, JsonObject } from './workflow-arguments';
import {
  HTTP_CALL_STEP_TYPE,
  HTTP_REQUEST_ADAPTER_ID,
  REDACTED_VALUE,
} from './workflows.constants';

/** `{{ secrets.alias.key }}`, `{{ payload.key }}` or `{{ execution.onboardingId }}`: no literal text. */
const PLACEHOLDER = String.raw`\{\{\s*(?:secrets|payload|execution)\.[\w.]+\s*\}\}`;

/** The only literal a header value may carry: an auth scheme word and a space before placeholders. */
const SCHEME_PREFIX = '(?:(?:Bearer|Basic|Token|Digest) )?';

const SAFE_HEADER_VALUE = new RegExp(`^${SCHEME_PREFIX}(?:${PLACEHOLDER})+$`);

/** A query value has no auth scheme: placeholders alone. */
const SAFE_QUERY_VALUE = new RegExp(`^(?:${PLACEHOLDER})+$`);

/** The request maps whose literal values are credentials, and the pattern a kept value matches. */
const REDACTED_REQUEST_MAPS = [
  { key: 'headers', safeValue: SAFE_HEADER_VALUE },
  { key: 'query', safeValue: SAFE_QUERY_VALUE },
] as const;

export interface RedactedDocument {
  document: JsonObject;
  /** The JSON path of every header or query value that was blanked. */
  redactions: string[];
}

/** An `http_request` connector declaration, or the typed step that always calls that connector. */
function isHttpRequestNode(node: JsonObject): boolean {
  return node.id === HTTP_REQUEST_ADAPTER_ID || node.type === HTTP_CALL_STEP_TYPE;
}

function getRequestMap(node: JsonObject, key: string): JsonObject | undefined {
  const request = isJsonObject(node.config) ? node.config.request : undefined;
  const entries = isJsonObject(request) ? request[key] : undefined;

  return isJsonObject(entries) ? entries : undefined;
}

/**
 * Copies a workflow document with every literal value under an `http_request` connector's
 * `config.request.headers` and `config.request.query` replaced by `[redacted]`, because a literal
 * there is usually a credential. A header value is kept only when it is placeholders alone,
 * optionally after one auth scheme word (`Bearer {{secrets.provider.token}}`), a query value only
 * when it is placeholders alone; any other literal text, even next to a placeholder, is blanked.
 * The request `url` and `body` are left as authored. The walk is generic, so it finds a connector
 * wherever a step type nests it.
 */
export function redactHttpRequest(source: JsonObject): RedactedDocument {
  const document = structuredClone(source);
  const redactions: string[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (isJsonObject(node)) {
      for (const { key, safeValue } of isHttpRequestNode(node) ? REDACTED_REQUEST_MAPS : []) {
        const entries = getRequestMap(node, key);

        if (entries) {
          for (const [name, value] of Object.entries(entries)) {
            if (typeof value !== 'string' || !safeValue.test(value)) {
              entries[name] = REDACTED_VALUE;
              redactions.push(`${path}.config.request.${key}.${name}`);
            }
          }
        }
      }
      Object.entries(node).forEach(([key, child]) => walk(child, `${path}.${key}`));
    }
  };

  walk(document, '$');

  return { document, redactions };
}
