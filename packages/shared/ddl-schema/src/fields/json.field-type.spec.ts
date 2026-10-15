import Ajv from 'ajv';
import type { RawWorkflowStep } from '../workflow-contract';
import { validateAndNormalizeWorkflow } from '../workflow-validator';
import { jsonFieldTypeDefinition } from './json.field-type';

const workflowWith = (fields: Record<string, unknown>) =>
  validateAndNormalizeWorkflow({
    id: 'json-field',
    version: 1,
    steps: [
      { name: 'collect', type: 'form', config: { fields }, edges: { success: 'done' } },
      { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
    ] as RawWorkflowStep[],
  });

describe('json field type', () => {
  it('normalises to the shared envelope with no members of its own', () => {
    const normalized = workflowWith({ report: { type: 'json', required: false } });

    expect(normalized.steps[0].data.report).toEqual({
      type: 'json',
      required: false,
      persist: true,
    });
  });

  it('keeps clientVisible: true through normalisation', () => {
    const normalized = workflowWith({
      report: { type: 'json', required: false, clientVisible: true },
    });

    expect(normalized.steps[0].data.report.clientVisible).toBe(true);
  });

  it('rejects a validation object', () => {
    expect(() =>
      workflowWith({ report: { type: 'json', required: false, validation: {} } }),
    ).toThrow();
  });

  it('accepts a nested object and rejects anything that is not an object', () => {
    const validate = new Ajv().compile(jsonFieldTypeDefinition.buildDataSchema());

    expect(validate({ scores: [{ id: 'a', nested: { deep: [1, 2, { x: null }] } }] })).toBe(true);
    expect(validate('report')).toBe(false);
    expect(validate([1])).toBe(false);
  });
});
