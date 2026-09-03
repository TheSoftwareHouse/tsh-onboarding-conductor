import Ajv from 'ajv';
import { listFieldTypes } from '../fields/field-type.registry';
import { listFieldFormatNames } from '../formats/field-format.registry';
import {
  CONNECTOR_RETRY_BOUNDS,
  CONNECTOR_TYPES,
  MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
} from '../workflow-contract';
import { getWorkflowJsonSchema } from './workflow-json-schema';
import { buildWorkflowJsonSchema } from './workflow-json-schema.builder';

type Definitions = Record<string, Record<string, unknown>>;

const getDefinitions = (): Definitions =>
  (getWorkflowJsonSchema() as { definitions: Definitions }).definitions;

const getProperties = (definitionName: string): Record<string, unknown> =>
  getDefinitions()[definitionName].properties as Record<string, unknown>;

const getConnectorItemSchema = (): Record<string, unknown> => {
  const schema = getWorkflowJsonSchema() as {
    properties: {
      steps: { items: { properties: { connectors: { items: Record<string, unknown> } } } };
    };
  };

  return schema.properties.steps.items.properties.connectors.items;
};

describe('workflow JSON schema', () => {
  it('is composed in memory and reused between calls', () => {
    expect(getWorkflowJsonSchema()).toBe(getWorkflowJsonSchema());
  });

  it('compiles on a strict Ajv instance', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true });

    expect(() => ajv.compile(buildWorkflowJsonSchema())).not.toThrow();
  });

  it('contributes a descriptor for every field type at every level it declares', () => {
    const definitions = getDefinitions();

    for (const fieldType of listFieldTypes()) {
      const capitalized = `${fieldType.type.charAt(0).toUpperCase()}${fieldType.type.slice(1)}`;

      for (const level of fieldType.levels) {
        const name =
          level === 'root' ? `${fieldType.type}Descriptor` : `${level}${capitalized}Descriptor`;

        expect(definitions[name]).toBeDefined();
      }
    }
  });

  it('registers each level list against the descriptors of that level', () => {
    const schema = getWorkflowJsonSchema() as {
      properties: {
        steps: {
          items: { properties: { data: { additionalProperties: { anyOf: { $ref: string }[] } } } };
        };
      };
    };

    expect(schema.properties.steps.items.properties.data.additionalProperties.anyOf).toEqual([
      { $ref: '#/definitions/textDescriptor' },
      { $ref: '#/definitions/numberDescriptor' },
      { $ref: '#/definitions/booleanDescriptor' },
      { $ref: '#/definitions/dateDescriptor' },
      { $ref: '#/definitions/fileDescriptor' },
      { $ref: '#/definitions/objectDescriptor' },
      { $ref: '#/definitions/arrayDescriptor' },
    ]);
    // `file` is root-only, so it must not appear in the nested or array-item lists.
    expect(getDefinitions().nestedFieldDescriptor.anyOf).toEqual([
      { $ref: '#/definitions/nestedTextDescriptor' },
      { $ref: '#/definitions/nestedNumberDescriptor' },
      { $ref: '#/definitions/nestedBooleanDescriptor' },
      { $ref: '#/definitions/nestedDateDescriptor' },
      { $ref: '#/definitions/nestedObjectDescriptor' },
      { $ref: '#/definitions/nestedArrayDescriptor' },
    ]);
    expect(getDefinitions().arrayItemDescriptor.anyOf).toEqual([
      { $ref: '#/definitions/arrayItemTextDescriptor' },
      { $ref: '#/definitions/arrayItemNumberDescriptor' },
      { $ref: '#/definitions/arrayItemBooleanDescriptor' },
      { $ref: '#/definitions/arrayItemDateDescriptor' },
      { $ref: '#/definitions/arrayItemObjectDescriptor' },
      { $ref: '#/definitions/arrayItemArrayDescriptor' },
    ]);
  });

  it('keeps the definition names the Ajv reason mapping matches on', () => {
    // `validateSchema` inspects these names in `schemaPath` to choose INVALID_SHAPE.
    const definitions = getDefinitions();

    expect(definitions.conditionAll).toBeDefined();
    expect(definitions.conditionAny).toBeDefined();
    expect(definitions.conditionNot).toBeDefined();
    expect(definitions.conditionFieldComparison).toBeDefined();
  });

  it('derives the text format enum from the format registry', () => {
    const format = getDefinitions().textValidation.properties as { format: { enum: string[] } };

    expect(format.format.enum).toEqual(listFieldFormatNames());
  });

  it('pins the full text descriptor at each level', () => {
    expect(getDefinitions().textDescriptor).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['type', 'required'],
      properties: {
        type: { enum: ['text', 'string'] },
        required: { type: 'boolean' },
        persist: { type: 'boolean' },
        when: { $ref: '#/definitions/condition' },
        validation: { $ref: '#/definitions/textValidation' },
      },
    });
    expect(getDefinitions().nestedTextDescriptor).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['type', 'required'],
      properties: {
        type: { enum: ['text', 'string'] },
        required: { type: 'boolean' },
        validation: { $ref: '#/definitions/textValidation' },
      },
    });
    expect(getDefinitions().arrayItemTextDescriptor).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { enum: ['text', 'string'] },
        validation: { $ref: '#/definitions/textValidation' },
      },
    });
  });

  describe('deliberate quirks', () => {
    it('omits `when` from the root object and array descriptors but declares it when nested', () => {
      expect(getProperties('objectDescriptor')).not.toHaveProperty('when');
      expect(getProperties('arrayDescriptor')).not.toHaveProperty('when');
      expect(getProperties('nestedObjectDescriptor')).toHaveProperty('when');
      expect(getProperties('nestedArrayDescriptor')).toHaveProperty('when');
    });

    it('spells the text type as an enum and every other type as a const', () => {
      expect(getProperties('textDescriptor').type).toEqual({ enum: ['text', 'string'] });
      expect(getProperties('numberDescriptor').type).toEqual({ const: 'number' });
      expect(getProperties('booleanDescriptor').type).toEqual({ const: 'boolean' });
      expect(getProperties('dateDescriptor').type).toEqual({ const: 'date' });
      expect(getProperties('fileDescriptor').type).toEqual({ const: 'file' });
      expect(getProperties('objectDescriptor').type).toEqual({ const: 'object' });
      expect(getProperties('arrayDescriptor').type).toEqual({ const: 'array' });
    });

    it('gives boolean validation no `manyOf`', () => {
      expect(getDefinitions().booleanValidation.properties).toEqual({
        oneOf: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'boolean' } },
      });
    });

    it('inlines file validation instead of sharing a definition, and pins `required` to true', () => {
      expect(getDefinitions().fileValidation).toBeUndefined();
      expect(getProperties('fileDescriptor').validation).toMatchObject({ type: 'object' });
      expect(getProperties('fileDescriptor').required).toEqual({ type: 'boolean', const: true });
      expect(getDefinitions().nestedFileDescriptor).toBeUndefined();
      expect(getDefinitions().arrayItemFileDescriptor).toBeUndefined();
    });

    it('declares array validation only at array level, never on items', () => {
      expect(getProperties('arrayDescriptor').validation).toEqual({
        $ref: '#/definitions/arrayValidation',
      });
      expect(getDefinitions().arrayValidation.properties).toEqual({
        minItems: { type: 'integer', minimum: 0 },
        maxItems: { type: 'integer', minimum: 0 },
      });
      expect(getProperties('objectDescriptor')).not.toHaveProperty('validation');
    });
  });

  describe('connector fallback and errorHandler', () => {
    it('adds errorHandler as an optional non-empty string on the connector item', () => {
      const connectorItem = getConnectorItemSchema() as {
        properties: Record<string, unknown>;
        required: string[];
      };

      expect(connectorItem.properties.errorHandler).toEqual({ type: 'string', minLength: 1 });
      expect(connectorItem.required).not.toContain('errorHandler');
    });

    it('declares fallback as a bounded array of closed entries, sharing the primary shapes for fieldMapping and config', () => {
      const connectorItem = getConnectorItemSchema() as { properties: Record<string, unknown> };
      const primaryFieldMapping = (connectorItem.properties as Record<string, unknown>)
        .fieldMapping;
      const primaryConfig = (connectorItem.properties as Record<string, unknown>).config;

      expect(connectorItem.properties.fallback).toEqual({
        type: 'array',
        minItems: 1,
        maxItems: MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'id', 'type'],
          properties: {
            name: { type: 'string', minLength: 1 },
            id: { type: 'string', minLength: 1 },
            type: { enum: [...CONNECTOR_TYPES] },
            fieldMapping: primaryFieldMapping,
            config: primaryConfig,
            retry: { $ref: '#/definitions/connectorRetry' },
          },
        },
      });
    });

    it('shares one retry definition between a connector and its fallback entries', () => {
      const connectorItem = getConnectorItemSchema() as { properties: Record<string, unknown> };

      expect(connectorItem.properties.retry).toEqual({ $ref: '#/definitions/connectorRetry' });
      expect(getDefinitions().connectorRetry).toEqual({
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
      });
    });
  });
});
