import { buildWorkflowJsonSchema } from '../schema/workflow-json-schema.builder';
import { workflowJsonSchema } from '../schema/workflow-json-schema';
import type { NormalizedWorkflowStep } from '../workflow-contract';
import { createStepDataValidator } from '../workflow-step-validator';
import type {
  AnyNormalizedField,
  JsonSchemaFragment,
  WorkflowFieldLevel,
  WorkflowFieldTypeDefinition,
} from './field-type.port';
import { FIELD_TYPE_DEFINITIONS, buildFieldTypeRegistry } from './field-type.registry';
import { buildFieldDescriptorSchema, buildFieldEnvelope } from './field-value.utils';
import { normalizeWorkflowField } from './field.normalizer';

type MoneyValidation = { currency: string };

type NormalizedMoneyField = AnyNormalizedField & { type: 'money'; validation: MoneyValidation };

/**
 * A field type added the way the extension guide describes: one module, nothing else. The rest of
 * this spec proves that is enough to reach the schema, the normalizer and the step-data validator.
 */
const moneyFieldTypeDefinition = {
  type: 'money',
  aliases: ['currency-amount'],
  levels: ['root', 'nested', 'arrayItem'],
  buildValidationSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['currency'],
      properties: { currency: { type: 'string', minLength: 3, maxLength: 3 } },
    };
  },
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment {
    return buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'money' },
      requiredMembers: ['validation'],
      members: { validation: { $ref: '#/definitions/moneyValidation' } },
      conditionLevels: ['root'],
    });
  },
  validateValidation(validation, fail) {
    if (typeof validation.currency !== 'string' || validation.currency.length !== 3) {
      fail('INVALID_VALUE');
    }
  },
  normalizeField(context, fail) {
    if (context.validation === undefined) {
      fail('INVALID_VALUE');
    }

    return buildFieldEnvelope(context, 'money', {
      validation: { currency: (context.validation as MoneyValidation).currency.toUpperCase() },
    });
  },
  buildDataSchema(field: AnyNormalizedField): JsonSchemaFragment {
    const { validation } = field as NormalizedMoneyField;

    return {
      type: 'object',
      additionalProperties: false,
      required: ['amount', 'currency'],
      properties: {
        amount: { type: 'number', minimum: 0 },
        currency: { const: validation.currency },
      },
    };
  },
} as const satisfies WorkflowFieldTypeDefinition;

const extendedRegistry = buildFieldTypeRegistry([
  ...FIELD_TYPE_DEFINITIONS,
  moneyFieldTypeDefinition,
]);

describe('registering a new field type', () => {
  it('reaches the generated contract at every level it declares', () => {
    const schema = buildWorkflowJsonSchema(extendedRegistry) as {
      definitions: Record<string, unknown>;
      properties: {
        steps: {
          items: { properties: { data: { additionalProperties: { anyOf: { $ref: string }[] } } } };
        };
      };
    };

    expect(schema.definitions.moneyValidation).toBeDefined();
    expect(schema.definitions.moneyDescriptor).toBeDefined();
    expect(schema.definitions.nestedMoneyDescriptor).toBeDefined();
    expect(schema.definitions.arrayItemMoneyDescriptor).toBeDefined();
    expect(schema.properties.steps.items.properties.data.additionalProperties.anyOf).toContainEqual(
      {
        $ref: '#/definitions/moneyDescriptor',
      },
    );
  });

  it('normalizes its fields, including through its alias', () => {
    const field = { type: 'currency-amount', required: true, validation: { currency: 'pln' } };

    expect(normalizeWorkflowField(field, 'root', extendedRegistry)).toEqual({
      type: 'money',
      required: true,
      persist: true,
      validation: { currency: 'PLN' },
    });
  });

  it('rejects a malformed validation object with the usual reason', () => {
    expect(() =>
      normalizeWorkflowField(
        { type: 'money', required: true, validation: { currency: 'zloty' } },
        'root',
        extendedRegistry,
      ),
    ).toThrow(expect.objectContaining({ reason: 'INVALID_VALUE' }));
  });

  it('contributes its own step data schema', () => {
    const step = {
      name: 'collect_price',
      status: 'awaiting_user',
      terminal: false,
      connectors: [],
      transitions: [],
      data: {
        price: normalizeWorkflowField(
          { type: 'money', required: true, validation: { currency: 'EUR' } },
          'root',
          extendedRegistry,
        ),
      },
    } as unknown as NormalizedWorkflowStep;

    const validator = createStepDataValidator(step, undefined, extendedRegistry);

    expect(validator({ price: { amount: 10, currency: 'EUR' } })).toBe(true);
    expect(validator({ price: { amount: -1, currency: 'EUR' } })).toBe(false);
    expect(validator({ price: { amount: 10, currency: 'USD' } })).toBe(false);
  });

  it('leaves the default registry and contract untouched', () => {
    const definitions = (workflowJsonSchema as { definitions: Record<string, unknown> })
      .definitions;

    expect(definitions.moneyDescriptor).toBeUndefined();
    expect(() => normalizeWorkflowField({ type: 'money', required: true }, 'root')).toThrow(
      expect.objectContaining({ reason: 'INVALID_VALUE' }),
    );
  });
});
