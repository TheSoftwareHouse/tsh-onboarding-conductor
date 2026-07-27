import { createStepDataValidator } from './workflow-step-validator';
import type { NormalizedWorkflowStep } from './workflow-contract';

const stepFixture: NormalizedWorkflowStep = {
  name: 'collect_email',
  status: 'awaiting_user',
  terminal: false,
  transitions: [{ status: 'success', target: 'approved' }],
  connectors: [],
  data: {
    email: {
      type: 'text',
      required: true,
      persist: true,
      validation: { format: 'email' },
    },
    displayName: {
      type: 'text',
      required: false,
      persist: true,
      validation: {
        minLength: 2,
        maxLength: 12,
        pattern: '^[A-Za-z]+$',
      },
    },
    age: {
      type: 'number',
      required: true,
      persist: true,
      validation: {
        minimum: 0,
        maximum: 100,
        exclusiveMinimum: -1,
        exclusiveMaximum: 101,
      },
    },
    startedAt: {
      type: 'date',
      required: false,
      persist: true,
      validation: {
        oneOf: ['2024-01-01', '2024-02-01'],
      },
    },
    acceptedTerms: {
      type: 'boolean',
      required: true,
      persist: true,
      validation: {
        oneOf: [true],
      },
    },
    identityDocument: {
      type: 'file',
      required: true,
      persist: true,
      validation: {
        contentTypes: ['image/png', 'image/jpeg'],
        maxSizeBytes: 1048576,
      },
    },
    cardNumber: {
      type: 'text',
      required: false,
      persist: true,
      validation: {
        format: 'credit-card',
      },
    },
    iban: {
      type: 'text',
      required: false,
      persist: true,
      validation: {
        format: 'account-number',
      },
    },
    tags: {
      type: 'text',
      required: false,
      persist: true,
      validation: {
        manyOf: ['alpha', 'beta', 'gamma'],
      },
    },
    scores: {
      type: 'number',
      required: false,
      persist: true,
      validation: {
        manyOf: [1, 2, 3],
      },
    },
  },
};

describe('createStepDataValidator', () => {
  it('creates a strict object validator for required and optional step fields', () => {
    const validator = createStepDataValidator(stepFixture);

    expect(validator.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['email', 'age', 'acceptedTerms', 'identityDocument'],
    });

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        displayName: 'Ada',
        startedAt: '2024-02-01',
        identityDocument: 'document-123',
        cardNumber: '4111-1111-1111-1111',
        iban: 'GB82 WEST 1234 5698 7654 32',
        tags: ['alpha', 'beta'],
        scores: [1, 3],
      }),
    ).toBe(true);
  });

  it('rejects undeclared properties, missing required values, and non-object bodies', () => {
    const validator = createStepDataValidator(stepFixture);

    expect(validator(null)).toBe(false);
    expect(validator('not-an-object')).toBe(false);
    expect(validator({ email: 'person@example.com', age: 18 })).toBe(false);
    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        unexpected: true,
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: '',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 123,
      }),
    ).toBe(false);
  });

  it('rejects type coercion and invalid date strings', () => {
    const validator = createStepDataValidator(stepFixture);

    expect(
      validator({
        email: 'person@example.com',
        age: '18',
        acceptedTerms: true,
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: 'true',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        startedAt: '2024-02-30',
      }),
    ).toBe(false);
  });

  it('enforces text length/pattern and numeric bounds', () => {
    const validator = createStepDataValidator(stepFixture);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        displayName: 'A',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        displayName: 'Ada',
      }),
    ).toBe(true);

    expect(
      validator({
        email: 'person@example.com',
        age: 101,
        acceptedTerms: true,
        identityDocument: 'document-123',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: -1,
        acceptedTerms: true,
        identityDocument: 'document-123',
      }),
    ).toBe(false);
  });

  it('enforces oneOf and manyOf values without allowing empty or duplicate selections', () => {
    const validator = createStepDataValidator(stepFixture);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: false,
        identityDocument: 'document-123',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        tags: ['alpha', 'alpha'],
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        tags: [],
      }),
    ).toBe(false);
  });

  it('accepts and rejects custom credit-card and account-number text formats', () => {
    const validator = createStepDataValidator(stepFixture);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        cardNumber: '4111-1111-1111-1111',
      }),
    ).toBe(true);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        cardNumber: '4111-1111-1111-1112',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        iban: 'DE89 3704 0044 0532 0130 00',
      }),
    ).toBe(true);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        iban: 'DE89 3704 0044 0532 0130 01',
      }),
    ).toBe(false);
  });
});
