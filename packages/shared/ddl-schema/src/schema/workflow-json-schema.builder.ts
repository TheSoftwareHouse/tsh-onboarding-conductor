import type { JsonSchemaFragment, WorkflowFieldLevel } from '../fields/field-type.port';
import {
  FIELD_TYPE_REGISTRY,
  listFieldTypes,
  type WorkflowFieldTypeRegistry,
} from '../fields/field-type.registry';
import { WORKFLOW_STATUSES } from '../workflow-contract';

const TRANSITION_STATUSES = [
  'success',
  'rejected',
  'manual.approve',
  'manual.reject',
  'manual.invalid',
];

const MANUAL_TRANSITION_STATUSES = TRANSITION_STATUSES.filter((status) =>
  status.startsWith('manual.'),
);

const capitalize = (value: string): string => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const getDescriptorName = (typeName: string, level: WorkflowFieldLevel): string => {
  if (level === 'root') {
    return `${typeName}Descriptor`;
  }

  return `${level}${capitalize(typeName)}Descriptor`;
};

/** Definitions that do not depend on the field-type registry. */
const buildSharedDefinitions = (): Record<string, JsonSchemaFragment> => ({
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
});

/**
 * Composes the committed draft-07 contract from the field-type registry, so a new field type
 * reaches the published schema without anyone editing JSON by hand.
 */
export const buildWorkflowJsonSchema = (
  registry: WorkflowFieldTypeRegistry = FIELD_TYPE_REGISTRY,
): Record<string, unknown> => {
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

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://tsh.dev/schemas/onboarding-workflow.schema.json',
    title: 'Onboarding workflow',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'version', 'name', 'steps'],
    properties: {
      id: { type: 'string', minLength: 1 },
      version: { type: 'integer', minimum: 1 },
      name: { type: 'string', minLength: 1 },
      initial: { type: 'string', minLength: 1 },
      webhook: { $ref: '#/definitions/rootWebhookDeclaration' },
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'status', 'data', 'transitions'],
          properties: {
            name: { type: 'string', minLength: 1 },
            status: { enum: [...WORKFLOW_STATUSES] },
            data: {
              type: 'object',
              propertyNames: { minLength: 1 },
              additionalProperties: { anyOf: descriptorRefsByLevel.root },
            },
            connectors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'type', 'order', 'fieldMapping'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  type: { type: 'string', minLength: 1 },
                  canReject: { type: 'boolean' },
                  async: { type: 'boolean' },
                  order: { type: 'integer', minimum: 1 },
                  fieldMapping: {
                    type: 'object',
                    propertyNames: { minLength: 1 },
                    additionalProperties: { type: 'string', minLength: 1 },
                  },
                  config: {
                    type: 'object',
                    additionalProperties: { $ref: '#/definitions/jsonValue' },
                  },
                },
              },
            },
            transitions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['status'],
                properties: {
                  status: { enum: TRANSITION_STATUSES },
                  target: { type: 'string', minLength: 1 },
                  when: { $ref: '#/definitions/condition' },
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
                ],
              },
            },
          },
        },
      },
    },
    definitions,
  };
};
