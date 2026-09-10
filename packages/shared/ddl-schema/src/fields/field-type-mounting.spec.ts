import { getCompiledWorkflowJsonSchema } from '../schema/compiled-workflow-json-schema';
import { registerFieldFormat } from '../formats/field-format.registry';
import { validateAndNormalizeUntypedSteps } from '../testing/untyped-steps.helper';
import type { JsonSchemaFragment, WorkflowFieldTypeDefinition } from './field-type.port';
import { registerFieldType } from './field-type.registry';
import { buildFieldDescriptorSchema, buildFieldEnvelope } from './field-value.utils';

/**
 * Mounting is the future runtime path: a field type or format arrives during startup, after the
 * package is imported, and must reach the in-memory contract without anyone regenerating a file.
 */
const durationFieldTypeDefinition: WorkflowFieldTypeDefinition = {
  type: 'duration',
  aliases: [],
  levels: ['root'],
  buildValidationSchema: (): JsonSchemaFragment => ({
    type: 'object',
    additionalProperties: false,
    properties: { unit: { enum: ['days', 'months'] } },
  }),
  buildDescriptorSchema: (level) =>
    buildFieldDescriptorSchema(level, {
      typeSchema: { const: 'duration' },
      members: { validation: { $ref: '#/definitions/durationValidation' } },
      conditionLevels: ['root'],
    }),
  validateValidation: (validation, fail) => {
    if (validation.unit !== 'days' && validation.unit !== 'months') {
      fail('INVALID_VALUE');
    }
  },
  normalizeField: (context) =>
    buildFieldEnvelope(context, 'duration', { validation: { ...context.validation } }),
  buildDataSchema: () => ({ type: 'integer', minimum: 0 }),
};

const workflowUsing = (field: Record<string, unknown>) => ({
  id: 'mounted',
  version: 1,
  name: 'Mounted',
  steps: [
    {
      name: 'collect',
      status: 'awaiting_user',
      data: { value: field },
      transitions: [{ status: 'success', target: 'done' }],
    },
    { name: 'done', status: 'approved', data: {}, transitions: [] },
  ],
});

describe('mounting a field type at startup', () => {
  it('rejects the type before it is mounted', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        workflowUsing({ type: 'duration', required: true, validation: { unit: 'days' } }),
      ),
    ).toThrow(expect.objectContaining({ reason: 'INVALID_VALUE' }));
  });

  it('accepts it once registered, without regenerating any file', () => {
    registerFieldType(durationFieldTypeDefinition);

    const normalized = validateAndNormalizeUntypedSteps(
      workflowUsing({ type: 'duration', required: true, validation: { unit: 'months' } }),
    );

    expect(normalized.stepsByName.collect.data.value).toEqual({
      type: 'duration',
      required: true,
      persist: true,
      validation: { unit: 'months' },
    });
  });

  it('rebuilds the in-memory contract so the mounted descriptor is part of it', () => {
    const definitions = (
      getCompiledWorkflowJsonSchema() as { definitions: Record<string, unknown> }
    ).definitions;

    expect(definitions.durationDescriptor).toBeDefined();
    expect(definitions.durationValidation).toBeDefined();
  });

  it('still enforces the validation rules the mounted type declares', () => {
    expect(() =>
      validateAndNormalizeUntypedSteps(
        workflowUsing({ type: 'duration', required: true, validation: { unit: 'weeks' } }),
      ),
    ).toThrow(expect.objectContaining({ reason: 'INVALID_VALUE' }));
  });

  it('mounts a text format the same way', () => {
    const isSortCode = (value: string): boolean => /^\d{2}-\d{2}-\d{2}$/.test(value);
    registerFieldFormat({ name: 'sort-code', provider: 'custom', validate: isSortCode });

    const normalized = validateAndNormalizeUntypedSteps(
      workflowUsing({ type: 'text', required: true, validation: { format: 'sort-code' } }),
    );

    expect(normalized.stepsByName.collect.data.value).toMatchObject({
      validation: { format: 'sort-code' },
    });
  });
});
