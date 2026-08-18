import type { HttpConnectorSecrets } from '../../../../config/http-connector-secrets.config';
import type { ConnectorExecutionContext } from '../../../ports/connector-adapter.port';

export const TEMPLATE_ROOTS = ['payload', 'secrets', 'execution'] as const;

export type TemplateRoot = (typeof TEMPLATE_ROOTS)[number];

export const EXECUTION_TEMPLATE_KEYS = ['onboardingId', 'stepName'] as const;

export type ExecutionTemplateKey = (typeof EXECUTION_TEMPLATE_KEYS)[number];

export type TemplateReference = {
  readonly root: TemplateRoot;
  readonly path: readonly string[];
  readonly expression: string;
};

export type TemplateScope = {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly secrets: HttpConnectorSecrets;
  readonly execution: ConnectorExecutionContext;
};

type TemplateSegment =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'reference'; readonly reference: TemplateReference };

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;
const EXPRESSION_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)+$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTemplateRoot = (value: string): value is TemplateRoot =>
  (TEMPLATE_ROOTS as readonly string[]).includes(value);

const parseReference = (rawExpression: string): TemplateReference => {
  const expression = rawExpression.trim();

  if (!EXPRESSION_PATTERN.test(expression)) {
    throw new Error(`Malformed placeholder expression "{{${rawExpression}}}"`);
  }

  const [root, ...path] = expression.split('.');

  if (!isTemplateRoot(root)) {
    throw new Error(
      `Unknown placeholder namespace "${root}" in "{{${expression}}}", expected one of ${TEMPLATE_ROOTS.join(', ')}`,
    );
  }

  if (root === 'payload' && path.length !== 1) {
    throw new Error(`Placeholder "{{${expression}}}" must reference exactly one payload key`);
  }

  if (root === 'secrets' && path.length !== 2) {
    throw new Error(`Placeholder "{{${expression}}}" must reference a secret as secrets.alias.key`);
  }

  if (root === 'execution') {
    const [key] = path;

    if (path.length !== 1 || !(EXECUTION_TEMPLATE_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `Placeholder "{{${expression}}}" must reference one of ${EXECUTION_TEMPLATE_KEYS.map((executionKey) => `execution.${executionKey}`).join(', ')}`,
      );
    }
  }

  return { root, path, expression };
};

export function parseTemplate(text: string): readonly TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const literal = text.slice(lastIndex, match.index);

    if (literal.length > 0) {
      segments.push({ kind: 'literal', text: literal });
    }

    segments.push({ kind: 'reference', reference: parseReference(match[1]) });
    lastIndex = match.index + match[0].length;
  }

  const trailingLiteral = text.slice(lastIndex);

  if (trailingLiteral.length > 0) {
    segments.push({ kind: 'literal', text: trailingLiteral });
  }

  for (const segment of segments) {
    if (
      segment.kind === 'literal' &&
      (segment.text.includes('{{') || segment.text.includes('}}'))
    ) {
      throw new Error(`Unbalanced placeholder braces in "${text}"`);
    }
  }

  return segments;
}

export function collectTemplateReferences(value: unknown): readonly TemplateReference[] {
  if (typeof value === 'string') {
    return parseTemplate(value).flatMap((segment) =>
      segment.kind === 'reference' ? [segment.reference] : [],
    );
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTemplateReferences(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).flatMap((item) => collectTemplateReferences(item));
  }

  return [];
}

const resolveReference = (reference: TemplateReference, scope: TemplateScope): unknown => {
  if (reference.root === 'payload') {
    const [key] = reference.path;

    if (!Object.prototype.hasOwnProperty.call(scope.payload, key)) {
      throw new Error(`Payload field "${key}" is not available for "{{${reference.expression}}}"`);
    }

    return scope.payload[key];
  }

  if (reference.root === 'secrets') {
    const [alias, key] = reference.path;
    const aliasSecrets = scope.secrets[alias];

    if (!aliasSecrets || !Object.prototype.hasOwnProperty.call(aliasSecrets, key)) {
      throw new Error(`Secret "${alias}.${key}" is not configured`);
    }

    return aliasSecrets[key];
  }

  return scope.execution[reference.path[0] as ExecutionTemplateKey];
};

export function resolveTemplateValue(value: unknown, scope: TemplateScope): unknown {
  if (typeof value === 'string') {
    const segments = parseTemplate(value);

    if (segments.length === 1 && segments[0].kind === 'reference') {
      return resolveReference(segments[0].reference, scope);
    }

    return segments
      .map((segment) => {
        if (segment.kind === 'literal') {
          return segment.text;
        }

        const resolved = resolveReference(segment.reference, scope);

        if (typeof resolved === 'object' || resolved === undefined) {
          throw new Error(
            `Placeholder "{{${segment.reference.expression}}}" must resolve to a scalar when embedded in text`,
          );
        }

        return String(resolved);
      })
      .join('');
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateValue(item, scope));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplateValue(item, scope)]),
    );
  }

  return value;
}
