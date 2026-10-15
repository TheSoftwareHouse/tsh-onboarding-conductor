import Ajv from 'ajv';
import { listFieldTypes } from '../fields/field-type.registry';
import { listFieldFormatNames } from '../formats/field-format.registry';
import {
  CONNECTOR_RETRY_BOUNDS,
  CONNECTOR_TYPES,
  MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
  WORKFLOW_SCORE_COMPARATORS,
} from '../workflow-contract';
import { getCompiledWorkflowJsonSchema } from './compiled-workflow-json-schema';
import { buildCompiledWorkflowJsonSchema } from './workflow-json-schema.builder';

type Definitions = Record<string, Record<string, unknown>>;

const getDefinitions = (): Definitions =>
  (getCompiledWorkflowJsonSchema() as { definitions: Definitions }).definitions;

const getProperties = (definitionName: string): Record<string, unknown> =>
  getDefinitions()[definitionName].properties as Record<string, unknown>;

// A step's connectors and transitions point at shared definitions, because the workflow schema validates
// a hand-written declaration — a `custom`'s, a `connector-call`'s — against the same shapes.
const getConnectorItemSchema = (): Record<string, unknown> => getDefinitions().connectorDeclaration;

const getStepSchema = (): Record<string, unknown> => {
  const schema = getCompiledWorkflowJsonSchema() as {
    properties: { steps: { items: Record<string, unknown> } };
  };

  return schema.properties.steps.items;
};

const getTransitionWhen = (): unknown => getProperties('transition').when;

describe('workflow JSON schema', () => {
  it('is composed in memory and reused between calls', () => {
    expect(getCompiledWorkflowJsonSchema()).toBe(getCompiledWorkflowJsonSchema());
  });

  it('compiles on a strict Ajv instance', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true });

    expect(() => ajv.compile(buildCompiledWorkflowJsonSchema())).not.toThrow();
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
    const schema = getCompiledWorkflowJsonSchema() as {
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
      { $ref: '#/definitions/jsonDescriptor' },
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
        clientVisible: { type: 'boolean' },
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

    it('declares fallback as a bounded array of closed entries, sharing the primary shapes for both field mappings and config', () => {
      const connectorItem = getConnectorItemSchema() as { properties: Record<string, unknown> };
      const primaryFieldMapping = (connectorItem.properties as Record<string, unknown>)
        .fieldMapping;
      const primaryOptionalFieldMapping = (connectorItem.properties as Record<string, unknown>)
        .optionalFieldMapping;
      const primaryConfig = (connectorItem.properties as Record<string, unknown>).config;

      expect(connectorItem.properties.fallback).toEqual({
        type: 'array',
        minItems: 1,
        maxItems: MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
        items: { $ref: '#/definitions/connectorFallbackDeclaration' },
      });
      expect(getDefinitions().connectorFallbackDeclaration).toEqual({
        type: 'object',
        additionalProperties: false,
        required: ['name', 'id', 'type'],
        properties: {
          name: { type: 'string', minLength: 1 },
          id: { type: 'string', minLength: 1 },
          type: { enum: [...CONNECTOR_TYPES] },
          fieldMapping: primaryFieldMapping,
          optionalFieldMapping: primaryOptionalFieldMapping,
          config: primaryConfig,
          retry: { $ref: '#/definitions/connectorRetry' },
        },
      });
    });

    it('points a step at the shared connector and transition definitions', () => {
      const stepProperties = (getStepSchema() as { properties: Record<string, unknown> })
        .properties;

      expect(stepProperties.connectors).toEqual({
        type: 'array',
        items: { $ref: '#/definitions/connectorDeclaration' },
      });
      expect(stepProperties.transitions).toEqual({
        type: 'array',
        items: { $ref: '#/definitions/transition' },
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

  describe('scoring', () => {
    it("declares `scoring` at the root and on a step, and repoints a transition's `when` to `transitionCondition`", () => {
      const schema = getCompiledWorkflowJsonSchema() as {
        properties: { scoring: Record<string, unknown> };
      };

      expect(schema.properties.scoring).toEqual({
        type: 'object',
        // A score name is a name like any other, so it is refused the members of Object.prototype.
        propertyNames: { $ref: '#/definitions/safeName' },
        additionalProperties: { $ref: '#/definitions/scoreDeclaration' },
      });
      expect(
        (getStepSchema() as { properties: Record<string, unknown> }).properties.scoring,
      ).toEqual({
        type: 'array',
        minItems: 1,
        items: { $ref: '#/definitions/scoringRule' },
      });
      expect(getTransitionWhen()).toEqual({ $ref: '#/definitions/transitionCondition' });
    });

    it("keeps a field descriptor's `when` on `condition`, out of reach of the score leaf", () => {
      expect(getProperties('textDescriptor').when).toEqual({
        $ref: '#/definitions/condition',
      });
      expect(getProperties('nestedObjectDescriptor').when).toEqual({
        $ref: '#/definitions/condition',
      });
    });

    it("keeps a scoring rule's `when` on `condition`, out of reach of the score leaf", () => {
      expect(getProperties('scoringRule').when).toEqual({ $ref: '#/definitions/condition' });
    });

    it("builds `conditionScoreComparison`'s properties by iterating `WORKFLOW_SCORE_COMPARATORS`, so the two cannot drift", () => {
      const properties = getProperties('conditionScoreComparison');

      expect(Object.keys(properties).sort()).toEqual(
        ['score', ...WORKFLOW_SCORE_COMPARATORS].sort(),
      );
      for (const comparator of WORKFLOW_SCORE_COMPARATORS) {
        expect(properties[comparator]).toEqual({ type: 'integer' });
      }
    });

    it("recurses `transitionCondition`'s `all`/`any`/`not` branches into itself and offers the score leaf as a fifth alternative", () => {
      const definitions = getDefinitions();

      expect(definitions.transitionConditionAll).toEqual({
        type: 'object',
        additionalProperties: false,
        required: ['all'],
        properties: {
          all: { type: 'array', minItems: 1, items: { $ref: '#/definitions/transitionCondition' } },
        },
      });
      expect(definitions.transitionConditionAny).toEqual({
        type: 'object',
        additionalProperties: false,
        required: ['any'],
        properties: {
          any: { type: 'array', minItems: 1, items: { $ref: '#/definitions/transitionCondition' } },
        },
      });
      expect(definitions.transitionConditionNot).toEqual({
        type: 'object',
        additionalProperties: false,
        required: ['not'],
        properties: {
          not: { $ref: '#/definitions/transitionCondition' },
        },
      });
      expect((definitions.transitionCondition as { oneOf: unknown[] }).oneOf).toEqual([
        { $ref: '#/definitions/transitionConditionAll' },
        { $ref: '#/definitions/transitionConditionAny' },
        { $ref: '#/definitions/transitionConditionNot' },
        { $ref: '#/definitions/conditionFieldComparison' },
        { $ref: '#/definitions/conditionScoreComparison' },
      ]);
    });
  });
});
