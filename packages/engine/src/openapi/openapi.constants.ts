/**
 * Names the OpenAPI document and the decorators that feed it share. Kept apart from the builder so
 * a controller or a decorator can name a tag or a component without pulling the document builder,
 * and the DDL package it embeds, into its own import graph.
 */

/**
 * Where the running engine serves the document. Under `/v1` deliberately: the admin panel's SPA
 * fallback answers every path outside that prefix with `index.html`.
 */
export const OPENAPI_DOCUMENT_PATH = '/v1/openapi.json';

/** The bearer scheme every admin operation references; `buildOpenApiDocument` registers it. */
export const ADMIN_BEARER_AUTH = 'entraBearer';

/** Components decorators reference by `$ref`; `buildOpenApiDocument` fills each of them in. */
export const API_ERROR_SCHEMA = 'ApiError';
export const NEST_HTTP_ERROR_SCHEMA = 'NestHttpError';
export const WORKFLOW_DOCUMENT_SCHEMA = 'WorkflowDocument';
export const NODE_GRAPH_DOCUMENT_SCHEMA = 'NodeGraphDocument';

export function schemaRef(name: string): string {
  return `#/components/schemas/${name}`;
}

export type ApiTag = Readonly<{ name: string; description: string }>;

/**
 * One tag per audience and resource. The reader-facing documentation groups operations by tag, so
 * the split states who calls a route and under what credential before any single operation does.
 */
export const API_TAGS = {
  health: {
    name: 'Health',
    description: 'Liveness for orchestration and load balancers. Unauthenticated.',
  },
  onboardingFlow: {
    name: 'Onboarding flow',
    description:
      "The end customer's own onboarding: start it, read the step to render, submit that step's " +
      'data and upload the documents a step asks for. These routes carry no authentication ' +
      'because an end customer holds no operator identity; the onboarding id is the only handle, ' +
      'so treat it as a capability and never log or share it.',
  },
  manualReview: {
    name: 'Manual review',
    description:
      "An operator's decision on an onboarding waiting in `awaiting_manual_review`. " +
      'Unauthenticated today, unlike the rest of the operator surface: the route predates admin ' +
      'sign-in and has not been moved behind it. Treat this as a known gap rather than a design ' +
      "intent, and keep a network boundary in front of the engine's port.",
  },
  providerCallbacks: {
    name: 'Provider callbacks',
    description:
      'Asynchronous results a provider posts back after a connector step. Authenticated by the ' +
      'HMAC recipe the connector adapter declares (header names, digest, encoding, timestamp ' +
      'tolerance), verified over the raw body before anything else happens to the request.',
  },
  adminOnboardings: {
    name: 'Admin: onboardings',
    description:
      'Operator reads over every onboarding: the paginated list, one record and the states it ' +
      'moved through. Requires an operator bearer token.',
  },
  adminWorkflows: {
    name: 'Admin: workflows',
    description:
      'The workflow catalogue as a reader sees it, and a dry compile of a document that stores ' +
      'nothing. Requires an operator bearer token.',
  },
  adminNodeTypes: {
    name: 'Admin: node types',
    description:
      'The node palette a workflow builder offers and the JSON Schema a node graph must satisfy. ' +
      'Requires an operator bearer token.',
  },
  adminConnectors: {
    name: 'Admin: connectors',
    description:
      'Operator-provided connector settings, including credentials. A secret value never leaves ' +
      'the engine: the read side reports that a secret is set, not what it is. Requires an ' +
      'operator bearer token.',
  },
  adminAudit: {
    name: 'Admin: audit',
    description: 'The paginated audit log with its filters. Requires an operator bearer token.',
  },
} as const satisfies Record<string, ApiTag>;

/** Any JSON value; used where a step field's persisted value is echoed back. */
export const JSON_VALUE_SCHEMA = 'JsonValue';
/** A workflow condition in its normalized form, as the admin read surface and the state endpoint expose it. */
export const WORKFLOW_CONDITION_SCHEMA = 'WorkflowCondition';
