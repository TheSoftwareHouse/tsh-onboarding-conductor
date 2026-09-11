import type { JsonSchemaFragment, WorkflowFieldLevel } from '../fields/field-type.port';
import {
  getFieldTypeRegistry,
  listFieldTypes,
  type WorkflowFieldTypeRegistry,
} from '../fields/field-type.registry';
import {
  CONNECTOR_REJECTION_REASONS,
  CONNECTOR_RETRY_BOUNDS,
  CONNECTOR_TYPES,
  MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
  UNSAFE_NAMES,
  WORKFLOW_SCORE_COMPARATORS,
  WORKFLOW_STATUSES,
  type WorkflowTransitionStatus,
} from '../workflow-contract';

const TRANSITION_STATUSES = [
  'success',
  'rejected',
  'manual.approve',
  'manual.reject',
  'manual.invalid',
] as const satisfies readonly WorkflowTransitionStatus[];

const MANUAL_TRANSITION_STATUSES = TRANSITION_STATUSES.filter((status) =>
  status.startsWith('manual.'),
);

// Iterated rather than hardcoded, so `conditionScoreComparison` and `transitionCondition` cannot
// drift from `WORKFLOW_SCORE_COMPARATORS`.
const SCORE_COMPARATOR_PROPERTIES: Record<string, JsonSchemaFragment> = Object.fromEntries(
  WORKFLOW_SCORE_COMPARATORS.map((comparator) => [comparator, { type: 'integer' }]),
);

const capitalize = (value: string): string => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const getDescriptorName = (typeName: string, level: WorkflowFieldLevel): string => {
  if (level === 'root') {
    return `${typeName}Descriptor`;
  }

  return `${level}${capitalize(typeName)}Descriptor`;
};

/** Definitions that do not depend on the field-type registry. */
export const buildSharedDefinitions = (): Record<string, JsonSchemaFragment> => ({
  // Every name a document invents — step, field, port, score — passes through this. See
  // `UNSAFE_NAMES` for why three otherwise ordinary strings are refused.
  safeName: {
    type: 'string',
    minLength: 1,
    not: { enum: [...UNSAFE_NAMES] },
  },
  connectorRetry: {
    type: 'object',
    additionalProperties: false,
    properties: {
      maxAttempts: {
        type: 'integer',
        minimum: CONNECTOR_RETRY_BOUNDS.minAttempts,
        maximum: CONNECTOR_RETRY_BOUNDS.maxAttempts,
      },
      delayMs: {
        type: 'integer',
        minimum: CONNECTOR_RETRY_BOUNDS.minDelayMs,
        maximum: CONNECTOR_RETRY_BOUNDS.maxDelayMs,
      },
    },
  },
  connectorFieldMapping: {
    type: 'object',
    propertyNames: { minLength: 1 },
    additionalProperties: { type: 'string', minLength: 1 },
  },
  connectorConfig: {
    type: 'object',
    additionalProperties: { $ref: '#/definitions/jsonValue' },
  },
  connectorFallbackDeclaration: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'id', 'type'],
    properties: {
      name: { type: 'string', minLength: 1 },
      id: { type: 'string', minLength: 1 },
      type: { enum: [...CONNECTOR_TYPES] },
      fieldMapping: { $ref: '#/definitions/connectorFieldMapping' },
      optionalFieldMapping: { $ref: '#/definitions/connectorFieldMapping' },
      config: { $ref: '#/definitions/connectorConfig' },
      retry: { $ref: '#/definitions/connectorRetry' },
    },
  },
  // Named rather than inlined under `steps`, because the workflow schema validates a hand-written
  // declaration — a `custom` step's, a `connector-call`'s — against the same shape.
  connectorDeclaration: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'id', 'type', 'order', 'fieldMapping'],
    properties: {
      name: { type: 'string', minLength: 1 },
      id: { type: 'string', minLength: 1 },
      type: { enum: [...CONNECTOR_TYPES] },
      canReject: { type: 'boolean' },
      async: { type: 'boolean' },
      order: { type: 'integer', minimum: 1 },
      fieldMapping: { $ref: '#/definitions/connectorFieldMapping' },
      optionalFieldMapping: { $ref: '#/definitions/connectorFieldMapping' },
      config: { $ref: '#/definitions/connectorConfig' },
      errorHandler: { type: 'string', minLength: 1 },
      retry: { $ref: '#/definitions/connectorRetry' },
      fallback: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
        items: { $ref: '#/definitions/connectorFallbackDeclaration' },
      },
    },
  },
  transition: {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: {
      status: { enum: [...TRANSITION_STATUSES] },
      target: { type: 'string', minLength: 1 },
      when: { $ref: '#/definitions/transitionCondition' },
      reason: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { enum: [...CONNECTOR_REJECTION_REASONS] },
      },
      webhook: { $ref: '#/definitions/transitionWebhookDeclaration' },
    },
    allOf: [
      {
        if: {
          properties: { status: { enum: MANUAL_TRANSITION_STATUSES } },
          required: ['status'],
        },
        then: {
          properties: { target: { type: 'string', minLength: 1 } },
          required: ['target'],
        },
      },
      {
        // A refusal reason only means something on a refusal.
        if: {
          properties: { status: { not: { const: 'rejected' } } },
          required: ['status'],
        },
        then: { properties: { reason: false } },
      },
    ],
  },
  jsonObject: {
    type: 'object',
    additionalProperties: { $ref: '#/definitions/jsonValue' },
  },
  jsonValue: {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'null' },
      { type: 'array', items: { $ref: '#/definitions/jsonValue' } },
      { $ref: '#/definitions/jsonObject' },
    ],
  },
  conditionScalar: {
    type: ['string', 'number', 'boolean', 'null'],
  },
  condition: {
    type: 'object',
    additionalProperties: false,
    properties: {
      all: { type: 'array', minItems: 1, items: { $ref: '#/definitions/condition' } },
      any: { type: 'array', minItems: 1, items: { $ref: '#/definitions/condition' } },
      not: { $ref: '#/definitions/condition' },
      field: { type: 'string', minLength: 1 },
      equals: { $ref: '#/definitions/conditionScalar' },
      in: { type: 'array', minItems: 1, items: { $ref: '#/definitions/conditionScalar' } },
      isSet: { type: 'boolean' },
    },
    oneOf: [
      { $ref: '#/definitions/conditionAll' },
      { $ref: '#/definitions/conditionAny' },
      { $ref: '#/definitions/conditionNot' },
      { $ref: '#/definitions/conditionFieldComparison' },
    ],
  },
  conditionAll: {
    type: 'object',
    additionalProperties: false,
    required: ['all'],
    properties: {
      all: { type: 'array', minItems: 1, items: { $ref: '#/definitions/condition' } },
    },
  },
  conditionAny: {
    type: 'object',
    additionalProperties: false,
    required: ['any'],
    properties: {
      any: { type: 'array', minItems: 1, items: { $ref: '#/definitions/condition' } },
    },
  },
  conditionNot: {
    type: 'object',
    additionalProperties: false,
    required: ['not'],
    properties: {
      not: { $ref: '#/definitions/condition' },
    },
  },
  conditionFieldComparison: {
    type: 'object',
    additionalProperties: false,
    required: ['field'],
    properties: {
      field: { type: 'string', minLength: 1 },
      equals: { $ref: '#/definitions/conditionScalar' },
      in: { type: 'array', minItems: 1, items: { $ref: '#/definitions/conditionScalar' } },
      isSet: { type: 'boolean' },
    },
  },
  // Legal only inside a transition's `when` — see `transitionCondition` below.
  conditionScoreComparison: {
    type: 'object',
    additionalProperties: false,
    required: ['score'],
    properties: {
      score: { type: 'string', minLength: 1 },
      ...SCORE_COMPARATOR_PROPERTIES,
    },
  },
  // Parallel to the `condition` family, but with a score leaf as a fifth alternative. A field's
  // `when` and a scoring rule's `when` keep pointing at `condition`; only a transition's `when`
  // resolves here, which is what keeps the score leaf out of reach everywhere else.
  transitionCondition: {
    type: 'object',
    additionalProperties: false,
    properties: {
      all: { type: 'array', minItems: 1, items: { $ref: '#/definitions/transitionCondition' } },
      any: { type: 'array', minItems: 1, items: { $ref: '#/definitions/transitionCondition' } },
      not: { $ref: '#/definitions/transitionCondition' },
      field: { type: 'string', minLength: 1 },
      equals: { $ref: '#/definitions/conditionScalar' },
      in: { type: 'array', minItems: 1, items: { $ref: '#/definitions/conditionScalar' } },
      isSet: { type: 'boolean' },
      score: { type: 'string', minLength: 1 },
      ...SCORE_COMPARATOR_PROPERTIES,
    },
    oneOf: [
      { $ref: '#/definitions/transitionConditionAll' },
      { $ref: '#/definitions/transitionConditionAny' },
      { $ref: '#/definitions/transitionConditionNot' },
      { $ref: '#/definitions/conditionFieldComparison' },
      { $ref: '#/definitions/conditionScoreComparison' },
    ],
  },
  transitionConditionAll: {
    type: 'object',
    additionalProperties: false,
    required: ['all'],
    properties: {
      all: { type: 'array', minItems: 1, items: { $ref: '#/definitions/transitionCondition' } },
    },
  },
  transitionConditionAny: {
    type: 'object',
    additionalProperties: false,
    required: ['any'],
    properties: {
      any: { type: 'array', minItems: 1, items: { $ref: '#/definitions/transitionCondition' } },
    },
  },
  transitionConditionNot: {
    type: 'object',
    additionalProperties: false,
    required: ['not'],
    properties: {
      not: { $ref: '#/definitions/transitionCondition' },
    },
  },
  scoreDeclaration: {
    type: 'object',
    additionalProperties: false,
    required: ['min', 'max'],
    properties: {
      min: { type: 'integer' },
      max: { type: 'integer' },
    },
  },
  scoringRule: {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'add'],
    properties: {
      score: { type: 'string', minLength: 1 },
      when: { $ref: '#/definitions/condition' },
      add: { type: 'integer' },
    },
  },
  rootWebhookDeclaration: {
    type: 'object',
    additionalProperties: false,
    required: ['notify'],
    properties: {
      notify: { $ref: '#/definitions/notifyWebhookDeclaration' },
    },
  },
  notifyWebhookDeclaration: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: { type: 'string', minLength: 1 },
    },
  },
  transitionWebhookDeclaration: {
    type: 'object',
    additionalProperties: false,
    required: ['notify'],
    properties: {
      notify: { const: false },
    },
  },
  // The key's shape and its uniqueness within the document are the normalizer's, as is the check
  // that `step` names a step of this workflow and `acceptedWhen` a persisted boolean field of it —
  // none of which a JSON Schema can express against another property's contents.
  agreementDeclaration: {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'step', 'acceptedWhen'],
    properties: {
      key: { type: 'string', minLength: 1 },
      step: { type: 'string', minLength: 1 },
      acceptedWhen: { type: 'string', minLength: 1 },
    },
  },
});

/**
 * Composes the committed draft-07 contract from the field-type registry, so a new field type
 * reaches the published schema without anyone editing JSON by hand.
 */
export type FieldSchemaDefinitions = {
  readonly definitions: Record<string, JsonSchemaFragment>;
  readonly descriptorRefsByLevel: Record<WorkflowFieldLevel, JsonSchemaFragment[]>;
};

/**
 * Every definition the field-type registry contributes, plus the per-level descriptor ref lists
 * built from them. Shared so the workflow schema validates a hand-written descriptor against the
 * same union the compiled schema does, rather than falling back to "some object".
 */
export const buildFieldSchemaDefinitions = (
  registry: WorkflowFieldTypeRegistry = getFieldTypeRegistry(),
): FieldSchemaDefinitions => {
  const fieldTypes = listFieldTypes(registry);
  const definitions: Record<string, JsonSchemaFragment> = buildSharedDefinitions();

  for (const fieldType of fieldTypes) {
    const validationSchema = fieldType.buildValidationSchema();
    if (validationSchema !== undefined) {
      definitions[`${fieldType.type}Validation`] = validationSchema;
    }
  }

  const descriptorRefsByLevel: Record<WorkflowFieldLevel, JsonSchemaFragment[]> = {
    root: [],
    nested: [],
    arrayItem: [],
  };

  for (const level of ['root', 'nested', 'arrayItem'] as const) {
    for (const fieldType of fieldTypes) {
      if (!fieldType.levels.includes(level)) {
        continue;
      }

      const descriptorName = getDescriptorName(fieldType.type, level);
      definitions[descriptorName] = fieldType.buildDescriptorSchema(level);
      descriptorRefsByLevel[level].push({ $ref: `#/definitions/${descriptorName}` });
    }

    if (level === 'nested') {
      definitions.nestedFieldDescriptor = { anyOf: descriptorRefsByLevel.nested };
    }

    if (level === 'arrayItem') {
      definitions.arrayItemDescriptor = { anyOf: descriptorRefsByLevel.arrayItem };
    }
  }

  return { definitions, descriptorRefsByLevel };
};

export const buildCompiledWorkflowJsonSchema = (
  registry: WorkflowFieldTypeRegistry = getFieldTypeRegistry(),
): Record<string, unknown> => {
  const { definitions, descriptorRefsByLevel } = buildFieldSchemaDefinitions(registry);

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://tsh.dev/schemas/onboarding-workflow-compiled.schema.json',
    title: 'Onboarding workflow (compiled)',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'version', 'name', 'steps'],
    properties: {
      id: { type: 'string', minLength: 1 },
      version: { type: 'integer', minimum: 1 },
      name: { type: 'string', minLength: 1 },
      initial: { type: 'string', minLength: 1 },
      webhook: { $ref: '#/definitions/rootWebhookDeclaration' },
      scoring: {
        type: 'object',
        propertyNames: { $ref: '#/definitions/safeName' },
        additionalProperties: { $ref: '#/definitions/scoreDeclaration' },
      },
      agreements: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/definitions/agreementDeclaration' },
      },
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'status', 'data', 'transitions'],
          properties: {
            name: { $ref: '#/definitions/safeName' },
            status: { enum: [...WORKFLOW_STATUSES] },
            data: {
              type: 'object',
              propertyNames: { $ref: '#/definitions/safeName' },
              additionalProperties: { anyOf: descriptorRefsByLevel.root },
            },
            scoring: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/definitions/scoringRule' },
            },
            connectors: {
              type: 'array',
              items: { $ref: '#/definitions/connectorDeclaration' },
            },
            transitions: {
              type: 'array',
              items: { $ref: '#/definitions/transition' },
            },
          },
        },
      },
    },
    definitions,
  };
};
