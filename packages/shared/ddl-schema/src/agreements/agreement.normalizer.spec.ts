import { normalizeWorkflowField } from '../fields/field.normalizer';
import type {
  CompiledWorkflowDefinition,
  NormalizedWorkflowField,
  NormalizedWorkflowStep,
} from '../workflow-contract';
import { WorkflowInvalidError } from '../workflow-invalid.error';
import { normalizeWorkflowAgreements } from './agreement.normalizer';

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

const buildStep = (
  name: string,
  data: Record<string, NormalizedWorkflowField>,
): NormalizedWorkflowStep => ({
  name,
  status: 'awaiting_user',
  data,
  connectors: [],
  transitions: [],
  terminal: false,
  scoring: [],
});

const stepsByName: Record<string, NormalizedWorkflowStep> = {
  accept_terms: buildStep('accept_terms', {
    termsAccepted: normalizeField({
      type: 'boolean',
      required: true,
      validation: { oneOf: [true] },
    }),
    privacyAccepted: normalizeField({ type: 'boolean', required: true }),
    fullName: normalizeField({ type: 'text', required: true }),
    unpersistedAcceptance: normalizeField({ type: 'boolean', required: true, persist: false }),
  }),
  collect_contact: buildStep('collect_contact', {
    contactAccepted: normalizeField({ type: 'boolean', required: true }),
  }),
};

const buildDefinition = (agreements?: unknown): CompiledWorkflowDefinition =>
  ({
    id: 'agreement-workflow',
    version: 1,
    initial: 'accept_terms',
    steps: [],
    ...(agreements === undefined ? {} : { agreements }),
  }) as CompiledWorkflowDefinition;

describe('normalizeWorkflowAgreements', () => {
  it('normalizes a workflow declaring no agreements to []', () => {
    expect(normalizeWorkflowAgreements(buildDefinition(), stepsByName)).toEqual([]);
  });

  it('normalizes a declaration naming a persisted boolean field of the step it binds to', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'termsAccepted' },
    ]);

    expect(normalizeWorkflowAgreements(definition, stepsByName)).toEqual([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'termsAccepted' },
    ]);
  });

  it('normalizes several families, each binding to its own step', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'termsAccepted' },
      { key: 'privacy-notice', step: 'accept_terms', acceptedWhen: 'privacyAccepted' },
      { key: 'contact-terms', step: 'collect_contact', acceptedWhen: 'contactAccepted' },
    ]);

    expect(normalizeWorkflowAgreements(definition, stepsByName)).toEqual([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'termsAccepted' },
      { key: 'privacy-notice', step: 'accept_terms', acceptedWhen: 'privacyAccepted' },
      { key: 'contact-terms', step: 'collect_contact', acceptedWhen: 'contactAccepted' },
    ]);
  });

  it.each([['a'], ['0'], ['eu-b2c-terms'], ['terms2024']])('accepts the key %s', (key: string) => {
    const definition = buildDefinition([
      { key, step: 'accept_terms', acceptedWhen: 'termsAccepted' },
    ]);

    expect(normalizeWorkflowAgreements(definition, stepsByName)).toEqual([
      { key, step: 'accept_terms', acceptedWhen: 'termsAccepted' },
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
    const definition = buildDefinition([
      { key, step: 'accept_terms', acceptedWhen: 'termsAccepted' },
    ]);

    expectReason(() => normalizeWorkflowAgreements(definition, stepsByName), 'INVALID_VALUE');
  });

  it('rejects a key declared twice', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'termsAccepted' },
      { key: 'eu-b2c-terms', step: 'collect_contact', acceptedWhen: 'contactAccepted' },
    ]);

    expectReason(() => normalizeWorkflowAgreements(definition, stepsByName), 'INVALID_VALUE');
  });

  it('rejects a step naming no step of the workflow', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'missing_step', acceptedWhen: 'termsAccepted' },
    ]);

    expectReason(() => normalizeWorkflowAgreements(definition, stepsByName), 'UNKNOWN_TARGET');
  });

  it('rejects an acceptedWhen naming a field of another step', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'collect_contact', acceptedWhen: 'termsAccepted' },
    ]);

    expectReason(() => normalizeWorkflowAgreements(definition, stepsByName), 'INVALID_VALUE');
  });

  it('rejects an acceptedWhen naming no field of the step', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'missing' },
    ]);

    expectReason(() => normalizeWorkflowAgreements(definition, stepsByName), 'INVALID_VALUE');
  });

  it('rejects an acceptedWhen naming a field that is not a boolean', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'fullName' },
    ]);

    expectReason(() => normalizeWorkflowAgreements(definition, stepsByName), 'INVALID_VALUE');
  });

  it('rejects an acceptedWhen naming a field declaring persist: false', () => {
    const definition = buildDefinition([
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'unpersistedAcceptance' },
    ]);

    expectReason(() => normalizeWorkflowAgreements(definition, stepsByName), 'INVALID_VALUE');
  });

  it.each([
    ['a non-array agreements block', {}],
    ['a non-object declaration', ['eu-b2c-terms']],
  ])('rejects %s', (_label: string, agreements: unknown) => {
    expectReason(
      () => normalizeWorkflowAgreements(buildDefinition(agreements), stepsByName),
      'INVALID_SHAPE',
    );
  });

  it.each([
    ['a missing key', { step: 'accept_terms', acceptedWhen: 'termsAccepted' }],
    ['a non-string key', { key: 1, step: 'accept_terms', acceptedWhen: 'termsAccepted' }],
    ['a missing step', { key: 'eu-b2c-terms', acceptedWhen: 'termsAccepted' }],
    ['a non-string step', { key: 'eu-b2c-terms', step: 1, acceptedWhen: 'termsAccepted' }],
    ['a missing acceptedWhen', { key: 'eu-b2c-terms', step: 'accept_terms' }],
    [
      'a non-string acceptedWhen',
      { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: true },
    ],
  ])('rejects a declaration with %s', (_label: string, agreement: unknown) => {
    expectReason(
      () => normalizeWorkflowAgreements(buildDefinition([agreement]), stepsByName),
      'INVALID_VALUE',
    );
  });
});
