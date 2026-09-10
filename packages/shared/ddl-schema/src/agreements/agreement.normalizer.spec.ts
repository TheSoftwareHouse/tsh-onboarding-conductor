import { normalizeWorkflowField } from '../fields/field.normalizer';
import type { CompiledWorkflowStep, NormalizedWorkflowField } from '../workflow-contract';
import { WorkflowInvalidError } from '../workflow-invalid.error';
import { normalizeStepAgreements } from './agreement.normalizer';

const expectReason = (fn: () => unknown, reason: string): void => {
  try {
    fn();
    throw new Error('Expected normalization to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowInvalidError);
    expect(error).toMatchObject({ reason });
  }
};

const normalizeField = (field: Record<string, unknown>): NormalizedWorkflowField =>
  normalizeWorkflowField(field, 'root') as NormalizedWorkflowField;

const acceptanceData: Record<string, NormalizedWorkflowField> = {
  termsAccepted: normalizeField({ type: 'boolean', required: true, validation: { oneOf: [true] } }),
  privacyAccepted: normalizeField({ type: 'boolean', required: true }),
  fullName: normalizeField({ type: 'text', required: true }),
  unpersistedAcceptance: normalizeField({ type: 'boolean', required: true, persist: false }),
};

const buildStep = (overrides: Partial<CompiledWorkflowStep> = {}): CompiledWorkflowStep => ({
  name: 'collect_contact',
  status: 'awaiting_user',
  data: {},
  transitions: [{ status: 'success', target: 'approved' }],
  ...overrides,
});

describe('normalizeStepAgreements', () => {
  it('normalizes a step declaring no agreements to []', () => {
    expect(normalizeStepAgreements(buildStep(), acceptanceData)).toEqual([]);
  });

  it('normalizes a declaration naming a persisted boolean field of the same step', () => {
    const step = buildStep({
      agreements: [{ key: 'eu-b2c-terms', acceptedWhen: 'termsAccepted' }],
    });

    expect(normalizeStepAgreements(step, acceptanceData)).toEqual([
      { key: 'eu-b2c-terms', acceptedWhen: 'termsAccepted' },
    ]);
  });

  it('normalizes several families collected by one step', () => {
    const step = buildStep({
      agreements: [
        { key: 'eu-b2c-terms', acceptedWhen: 'termsAccepted' },
        { key: 'privacy-notice', acceptedWhen: 'privacyAccepted' },
      ],
    });

    expect(normalizeStepAgreements(step, acceptanceData)).toEqual([
      { key: 'eu-b2c-terms', acceptedWhen: 'termsAccepted' },
      { key: 'privacy-notice', acceptedWhen: 'privacyAccepted' },
    ]);
  });

  it.each([['a'], ['0'], ['eu-b2c-terms'], ['terms2024']])('accepts the key %s', (key: string) => {
    const step = buildStep({ agreements: [{ key, acceptedWhen: 'termsAccepted' }] });

    expect(normalizeStepAgreements(step, acceptanceData)).toEqual([
      { key, acceptedWhen: 'termsAccepted' },
    ]);
  });

  it.each([
    ['an empty key', ''],
    ['a key opening on a dash', '-terms'],
    ['an uppercase key', 'EU-Terms'],
    ['a key carrying an underscore', 'eu_terms'],
    ['a key carrying a space', 'eu terms'],
    ['an untrimmed key', ' eu-terms '],
    ['a key carrying a dot', 'eu.terms'],
  ])('rejects %s', (_label: string, key: string) => {
    const step = buildStep({ agreements: [{ key, acceptedWhen: 'termsAccepted' }] });

    expectReason(() => normalizeStepAgreements(step, acceptanceData), 'INVALID_VALUE');
  });

  it('rejects a key repeated within one step', () => {
    const step = buildStep({
      agreements: [
        { key: 'eu-b2c-terms', acceptedWhen: 'termsAccepted' },
        { key: 'eu-b2c-terms', acceptedWhen: 'privacyAccepted' },
      ],
    });

    expectReason(() => normalizeStepAgreements(step, acceptanceData), 'INVALID_VALUE');
  });

  it('rejects an acceptedWhen naming no field of the step', () => {
    const step = buildStep({ agreements: [{ key: 'eu-b2c-terms', acceptedWhen: 'missing' }] });

    expectReason(() => normalizeStepAgreements(step, acceptanceData), 'INVALID_VALUE');
  });

  it('rejects an acceptedWhen naming a field that is not a boolean', () => {
    const step = buildStep({ agreements: [{ key: 'eu-b2c-terms', acceptedWhen: 'fullName' }] });

    expectReason(() => normalizeStepAgreements(step, acceptanceData), 'INVALID_VALUE');
  });

  it('rejects an acceptedWhen naming a field declaring persist: false', () => {
    const step = buildStep({
      agreements: [{ key: 'eu-b2c-terms', acceptedWhen: 'unpersistedAcceptance' }],
    });

    expectReason(() => normalizeStepAgreements(step, acceptanceData), 'INVALID_VALUE');
  });

  it.each([
    ['a non-array agreements block', {}],
    ['a non-object declaration', ['eu-b2c-terms']],
  ])('rejects %s', (_label: string, agreements: unknown) => {
    const step = buildStep({
      agreements: agreements as CompiledWorkflowStep['agreements'],
    });

    expectReason(() => normalizeStepAgreements(step, acceptanceData), 'INVALID_SHAPE');
  });

  it.each([
    ['a missing key', { acceptedWhen: 'termsAccepted' }],
    ['a non-string key', { key: 1, acceptedWhen: 'termsAccepted' }],
    ['a missing acceptedWhen', { key: 'eu-b2c-terms' }],
    ['a non-string acceptedWhen', { key: 'eu-b2c-terms', acceptedWhen: true }],
  ])('rejects a declaration with %s', (_label: string, agreement: unknown) => {
    const step = buildStep({
      agreements: [agreement] as CompiledWorkflowStep['agreements'],
    });

    expectReason(() => normalizeStepAgreements(step, acceptanceData), 'INVALID_VALUE');
  });
});
