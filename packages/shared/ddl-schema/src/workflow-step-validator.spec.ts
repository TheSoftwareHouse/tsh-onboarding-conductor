import { createStepDataValidator } from './workflow-step-validator';
import {
  DEFAULT_STEP_WEIGHT,
  DEFAULT_TRANSITION_POINTS,
  type NormalizedWorkflowField,
  type NormalizedWorkflowStep,
} from './workflow-contract';

/**
 * Field descriptors are open envelopes, so fixtures spell out the type-specific members the field
 * modules own (`validation`, `fields`, `items`).
 */
type FieldFixture = NormalizedWorkflowField & {
  validation?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  items?: Record<string, unknown>;
};

type StepFixture = Omit<NormalizedWorkflowStep, 'data'> & { data: Record<string, FieldFixture> };

const stepFixture: StepFixture = {
  name: 'collect_email',
  status: 'awaiting_user',
  terminal: false,
  transitions: [{ status: 'success', target: 'approved', points: DEFAULT_TRANSITION_POINTS }],
  connectors: [],
  scoring: { weight: DEFAULT_STEP_WEIGHT },
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
        iban: 'GB82 WEST 1234 5698 7654 32',
        tags: ['alpha', 'beta'],
        scores: [1, 3],
      }),
    ).toBe(true);
  });

  it('builds a strict schema from active fields and rejects inactive supplied values', () => {
    const validator = createStepDataValidator(stepFixture, [
      'email',
      'displayName',
      'identityDocument',
    ]);

    expect(validator.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['email', 'identityDocument'],
      properties: {
        email: expect.any(Object),
        displayName: expect.any(Object),
        identityDocument: expect.any(Object),
      },
    });

    expect(
      validator({
        email: 'person@example.com',
        displayName: 'Ada',
        identityDocument: 'document-123',
      }),
    ).toBe(true);

    expect(
      validator({
        email: 'person@example.com',
        displayName: 'Ada',
        identityDocument: 'document-123',
        age: 18,
      }),
    ).toBe(false);
  });

  it('treats an explicit empty active subset as no active fields', () => {
    const validator = createStepDataValidator(stepFixture, []);

    expect(validator.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {},
    });

    expect(validator({})).toBe(true);
    expect(validator({ email: 'person@example.com' })).toBe(false);
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

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        providerKey: 'stable-provider',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        callbackPath: '/v1/webhooks/provider/callback',
      }),
    ).toBe(false);

    expect(
      validator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
        secret: 'top-secret',
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

  it('accepts and rejects account-number text formats', () => {
    const validator = createStepDataValidator(stepFixture);

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

  it('supports recursive object and array fields with strict nested validation', () => {
    const nestedStep: StepFixture = {
      ...stepFixture,
      data: {
        payload: {
          type: 'object',
          required: true,
          persist: true,
          fields: {
            profileId: {
              type: 'text',
              required: true,
              validation: { format: 'uuid' },
            },
            website: {
              type: 'text',
              required: false,
              validation: { format: 'uri' },
            },
            phones: {
              type: 'array',
              required: true,
              validation: { minItems: 1 },
              items: {
                type: 'text',
                validation: { format: 'phone' },
              },
            },
          },
        },
      },
    };
    const validator = createStepDataValidator(nestedStep);

    expect(
      validator({
        payload: {
          profileId: '550e8400-e29b-41d4-a716-446655440000',
          website: 'https://tsh.io/onboarding',
          phones: ['+14155552671', '+48500100200'],
        },
      }),
    ).toBe(true);

    expect(
      validator({
        payload: {
          profileId: '550e8400-e29b-41d4-a716-446655440000',
          phones: ['+14155552671'],
          extra: 'nope',
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          profileId: 'not-a-uuid',
          phones: ['+14155552671'],
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          profileId: '550e8400-e29b-41d4-a716-446655440000',
          website: '/relative',
          phones: ['+14155552671'],
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          profileId: '550e8400-e29b-41d4-a716-446655440000',
          phones: ['14155552671'],
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          profileId: '550e8400-e29b-41d4-a716-446655440000',
          phones: '+14155552671',
        },
      }),
    ).toBe(false);
  });

  it('supports nested arrays of objects and rejects deep required/unknown/format violations', () => {
    const nestedArrayStep: StepFixture = {
      ...stepFixture,
      data: {
        payload: {
          type: 'object',
          required: true,
          persist: true,
          fields: {
            contacts: {
              type: 'array',
              required: true,
              validation: { minItems: 1 },
              items: {
                type: 'object',
                fields: {
                  profileId: {
                    type: 'text',
                    required: true,
                    validation: { format: 'uuid' },
                  },
                  phone: {
                    type: 'text',
                    required: true,
                    validation: { format: 'phone' },
                  },
                  links: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'object',
                      fields: {
                        url: {
                          type: 'text',
                          required: true,
                          validation: { format: 'uri' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const validator = createStepDataValidator(nestedArrayStep);

    expect(
      validator({
        payload: {
          contacts: [
            {
              profileId: '550e8400-e29b-41d4-a716-446655440000',
              phone: '+14155552671',
              links: [{ url: 'https://tsh.io/onboarding' }],
            },
          ],
        },
      }),
    ).toBe(true);

    expect(
      validator({
        payload: {
          contacts: [
            {
              phone: '+14155552671',
              links: [{ url: 'https://tsh.io/onboarding' }],
            },
          ],
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          contacts: [
            {
              profileId: '550e8400-e29b-41d4-a716-446655440000',
              phone: '+14155552671',
              links: [{ url: 'https://tsh.io/onboarding' }],
              extra: true,
            },
          ],
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          contacts: [
            {
              profileId: 'not-a-uuid',
              phone: '+14155552671',
              links: [{ url: 'https://tsh.io/onboarding' }],
            },
          ],
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          contacts: [
            {
              profileId: '550e8400-e29b-41d4-a716-446655440000',
              phone: '14155552671',
              links: [{ url: 'https://tsh.io/onboarding' }],
            },
          ],
        },
      }),
    ).toBe(false);

    expect(
      validator({
        payload: {
          contacts: [
            {
              profileId: '550e8400-e29b-41d4-a716-446655440000',
              phone: '+14155552671',
              links: [{ url: '/relative' }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it('builds a strict schema for active subsets and preserves the unconditional validator behavior', () => {
    const activeSubsetStep = {
      ...stepFixture,
      data: {
        email: stepFixture.data.email,
        acceptedTerms: stepFixture.data.acceptedTerms,
      },
    } as NormalizedWorkflowStep;
    const validator = createStepDataValidator(activeSubsetStep);

    expect(validator.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['email', 'acceptedTerms'],
    });
    expect(validator({ email: 'person@example.com', acceptedTerms: true })).toBe(true);
    expect(
      validator({ email: 'person@example.com', acceptedTerms: true, displayName: 'Ada' }),
    ).toBe(false);

    const unconditionalValidator = createStepDataValidator(stepFixture);
    expect(
      unconditionalValidator({
        email: 'person@example.com',
        age: 18,
        acceptedTerms: true,
        identityDocument: 'document-123',
      }),
    ).toBe(true);
  });
});
