import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '.';

const baseWorkflowFixture: Record<string, unknown> = {
  id: 'base',
  version: 1,
  name: 'Base',
  initial: 'collect_email',
  steps: [
    {
      name: 'collect_email',
      status: 'awaiting_user',
      data: {
        email: {
          type: 'text',
          required: true,
          validation: {
            format: 'email',
          },
        },
      },
      transitions: [
        {
          status: 'success',
          target: 'accept_terms',
        },
      ],
    },
    {
      name: 'accept_terms',
      status: 'awaiting_user',
      data: {
        acceptedTerms: {
          type: 'boolean',
          required: true,
          validation: {
            oneOf: [true],
          },
        },
      },
      transitions: [
        {
          status: 'success',
          target: 'approved',
        },
      ],
    },
    {
      name: 'approved',
      status: 'approved',
      data: {},
      transitions: [],
    },
  ],
};

const workflow = (): Record<string, unknown> => structuredClone(baseWorkflowFixture);

const expectInvalid = (input: unknown, reason?: string): void => {
  try {
    validateAndNormalizeWorkflow(input);
    throw new Error('Expected workflow validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowInvalidError);
    expect(error).toMatchObject({ code: 'WORKFLOW_INVALID' });
    if (reason) {
      expect(error).toMatchObject({ reason });
    }
    expect((error as Error).message).toBe('WORKFLOW_INVALID');
    expect((error as Error).message).not.toContain('base');
    expect((error as Error).message).not.toContain('collect_email');
  }
};

describe('validateAndNormalizeWorkflow', () => {
  it('normalizes a valid base-shaped definition and derives terminal metadata', () => {
    const normalized = validateAndNormalizeWorkflow(workflow());

    expect(normalized.initial).toBe('collect_email');
    expect(normalized.stepsByName.collect_email.terminal).toBe(false);
    expect(normalized.stepsByName.approved).toMatchObject({
      status: 'approved',
      terminal: true,
      transitions: [],
    });
    expect(normalized.stepsByName.accept_terms.transitions).toEqual([
      { status: 'success', target: 'approved' },
    ]);
  });

  it('normalizes connectors to an empty collection by default and sorts by ascending order', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0];
    firstStep.connectors = [
      {
        name: 'second',
        type: 'tsh_kyc',
        order: 10,
        fieldMapping: { email_out: 'email' },
      },
      {
        name: 'first',
        type: 'tsh_kyc',
        order: 2,
        fieldMapping: { email_in: 'email' },
      },
    ];

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.connectors).toEqual([
      {
        name: 'first',
        type: 'tsh_kyc',
        order: 2,
        fieldMapping: { email_in: 'email' },
      },
      {
        name: 'second',
        type: 'tsh_kyc',
        order: 10,
        fieldMapping: { email_out: 'email' },
      },
    ]);
    expect(normalized.stepsByName.accept_terms.connectors).toEqual([]);
  });

  it('allows connector mapping source fields declared in another workflow step', () => {
    const input = workflow();
    const secondStep = (input.steps as Record<string, unknown>[])[1];
    secondStep.connectors = [
      {
        name: 'cross_step',
        type: 'tsh_kyc_2',
        order: 1,
        fieldMapping: { email: 'email', acceptedTerms: 'acceptedTerms' },
      },
    ];

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.accept_terms.connectors).toEqual([
      {
        name: 'cross_step',
        type: 'tsh_kyc_2',
        order: 1,
        fieldMapping: { email: 'email', acceptedTerms: 'acceptedTerms' },
      },
    ]);
  });

  it('defaults initial to the first ordered step', () => {
    const input = workflow();
    delete input.initial;

    expect(validateAndNormalizeWorkflow(input).initial).toBe('collect_email');
  });

  it('accepts canonical types, optional descriptors, and the full bounded rule set', () => {
    const input = workflow();
    const step = (input.steps as Record<string, unknown>[])[0];
    const data = step.data as Record<string, unknown>;

    data.displayName = {
      type: 'text',
      required: false,
      validation: {
        minLength: 2,
        maxLength: 12,
        pattern: '^[A-Za-z]+$',
        format: 'account-number',
      },
    };
    data.score = {
      type: 'number',
      required: true,
      validation: {
        minimum: 0,
        maximum: 100,
        exclusiveMinimum: -1,
        exclusiveMaximum: 101,
      },
    };
    data.startedAt = {
      type: 'date',
      required: false,
      validation: {
        manyOf: ['2024-01-01', '2024-02-01'],
      },
    };
    data.featureFlag = {
      type: 'boolean',
      required: true,
      validation: {
        oneOf: [false],
      },
    };

    const normalized = validateAndNormalizeWorkflow(input);
    const fieldData = normalized.stepsByName.collect_email.data;

    expect(fieldData.displayName).toMatchObject({ type: 'text', required: false });
    expect(fieldData.score).toMatchObject({ type: 'number', required: true });
    expect(fieldData.startedAt).toMatchObject({ type: 'date', required: false });
    expect(fieldData.featureFlag).toMatchObject({ type: 'boolean', required: true });
  });

  it('normalizes the legacy string alias to text', () => {
    const input = workflow();
    const email = ((input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>)
      .email as Record<string, unknown>;
    email.type = 'string';

    const normalized = validateAndNormalizeWorkflow(input);
    expect(normalized.stepsByName.collect_email.data.email).toMatchObject({ type: 'text' });
  });

  it.each([
    ['workflow', (input: Record<string, unknown>) => (input.unexpected = true)],
    [
      'step',
      (input: Record<string, unknown>) =>
        ((input.steps as Record<string, unknown>[])[0].unexpected = true),
    ],
    [
      'field',
      (input: Record<string, unknown>) =>
        ((
          ((input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>)
            .email as Record<string, unknown>
        ).unexpected = true),
    ],
    [
      'validation',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        const field = (step.data as Record<string, unknown>).email as Record<string, unknown>;
        (field.validation as Record<string, unknown>).unexpected = true;
      },
    ],
    [
      'transition',
      (input: Record<string, unknown>) =>
        ((
          (input.steps as Record<string, unknown>[])[0].transitions as Record<string, unknown>[]
        )[0].unexpected = true),
    ],
  ])('rejects unknown properties at the %s level', (_level, mutate) => {
    const input = workflow();
    mutate(input);

    expectInvalid(input, 'UNKNOWN_PROPERTY');
  });

  it('rejects malformed non-object JSON and malformed nested values', () => {
    expectInvalid(null, 'INVALID_SHAPE');
    expectInvalid([], 'INVALID_SHAPE');

    const input = workflow();
    (input.steps as unknown[])[1] = 'not-a-step';
    expectInvalid(input, 'INVALID_SHAPE');
  });

  it.each([
    [
      'unsupported connector property',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          {
            name: 'kyc',
            type: 'tsh_kyc',
            order: 1,
            fieldMapping: { email: 'email' },
            unexpected: true,
          },
        ];
      },
      'UNKNOWN_PROPERTY',
    ],
    [
      'blank connector name',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          { name: ' ', type: 'tsh_kyc', order: 1, fieldMapping: { email: 'email' } },
        ];
      },
      'INVALID_VALUE',
    ],
    [
      'blank connector type',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [{ name: 'kyc', type: ' ', order: 1, fieldMapping: { email: 'email' } }];
      },
      'INVALID_VALUE',
    ],
    [
      'non-positive connector order',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          { name: 'kyc', type: 'tsh_kyc', order: 0, fieldMapping: { email: 'email' } },
        ];
      },
      'INVALID_VALUE',
    ],
    [
      'duplicate connector order',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          { name: 'one', type: 'tsh_kyc', order: 1, fieldMapping: { email: 'email' } },
          { name: 'two', type: 'tsh_kyc', order: 1, fieldMapping: { email: 'email' } },
        ];
      },
      'INVALID_VALUE',
    ],
    [
      'blank mapping payload key',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          { name: 'kyc', type: 'tsh_kyc', order: 1, fieldMapping: { ' ': 'email' } },
        ];
      },
      'INVALID_VALUE',
    ],
    [
      'unknown workflow mapping source',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          { name: 'kyc', type: 'tsh_kyc', order: 1, fieldMapping: { email: 'missing' } },
        ];
      },
      'INVALID_VALUE',
    ],
  ])('rejects invalid connector declarations for %s', (_label, mutate, reason) => {
    const input = workflow();
    mutate(input);

    expectInvalid(input, reason);
  });

  it('rejects empty, invalid, and duplicate steps', () => {
    const empty = workflow();
    empty.steps = [];
    expectInvalid(empty, 'INVALID_VALUE');

    const duplicate = workflow();
    (duplicate.steps as Record<string, unknown>[])[1].name = 'collect_email';
    expectInvalid(duplicate, 'DUPLICATE_STEP_NAME');

    const invalidName = workflow();
    (invalidName.steps as Record<string, unknown>[])[0].name = ' ';
    expectInvalid(invalidName, 'INVALID_VALUE');
  });

  it('rejects invalid initial references', () => {
    const input = workflow();
    input.initial = 'missing';

    expectInvalid(input, 'INVALID_VALUE');
  });

  it('rejects duplicate, unsupported, missing, and unknown transitions', () => {
    const duplicate = workflow();
    const firstTransitions = (duplicate.steps as Record<string, unknown>[])[0]
      .transitions as Record<string, unknown>[];
    firstTransitions.push({ status: 'success', target: 'accept_terms' });
    expectInvalid(duplicate, 'DUPLICATE_TRANSITION');

    const unsupported = workflow();
    (
      (unsupported.steps as Record<string, unknown>[])[0].transitions as Record<string, unknown>[]
    )[0].status = 'failure';
    expectInvalid(unsupported, 'INVALID_VALUE');

    const missing = workflow();
    (missing.steps as Record<string, unknown>[])[0].transitions = [];
    expectInvalid(missing, 'INVALID_TRANSITIONS');

    const unknown = workflow();
    (
      (unknown.steps as Record<string, unknown>[])[0].transitions as Record<string, unknown>[]
    )[0].target = 'missing';
    expectInvalid(unknown, 'UNKNOWN_TARGET');
  });

  it('rejects unsupported fields and validation rules', () => {
    const unsupportedType = workflow();
    (
      ((unsupportedType.steps as Record<string, unknown>[])[0].data as Record<string, unknown>)
        .email as Record<string, unknown>
    ).type = 'number';
    expectInvalid(unsupportedType, 'INVALID_VALUE');

    const unsupportedRule = workflow();
    const unsupportedRuleField = (
      (unsupportedRule.steps as Record<string, unknown>[])[0].data as Record<string, unknown>
    ).email as Record<string, unknown>;
    (unsupportedRuleField.validation as Record<string, unknown>).format = 'url';
    expectInvalid(unsupportedRule, 'INVALID_VALUE');

    const invalidConst = workflow();
    const terms = (invalidConst.steps as Record<string, unknown>[])[1].data as Record<
      string,
      unknown
    >;
    ((terms.acceptedTerms as Record<string, unknown>).validation as Record<string, unknown>).const =
      false;
    expectInvalid(invalidConst, 'INVALID_VALUE');
  });

  it('rejects incompatible option lists and unsupported selection rules', () => {
    const duplicateOptions = workflow();
    const emailField = (
      (duplicateOptions.steps as Record<string, unknown>[])[0].data as Record<string, unknown>
    ).email as Record<string, unknown>;
    (emailField.validation as Record<string, unknown>).oneOf = ['first', 'first'];
    expectInvalid(duplicateOptions, 'INVALID_VALUE');

    const incompatibleOption = workflow();
    const scoreField = (
      (incompatibleOption.steps as Record<string, unknown>[])[0].data as Record<string, unknown>
    ).email as Record<string, unknown>;
    scoreField.type = 'number';
    scoreField.validation = { oneOf: ['bad'] };
    expectInvalid(incompatibleOption, 'INVALID_VALUE');

    const invalidDateOption = workflow();
    const dateField = (
      (invalidDateOption.steps as Record<string, unknown>[])[0].data as Record<string, unknown>
    ).email as Record<string, unknown>;
    dateField.type = 'date';
    dateField.validation = { oneOf: ['not-a-date'] };
    expectInvalid(invalidDateOption, 'INVALID_VALUE');

    const booleanManyOf = workflow();
    const terms = (booleanManyOf.steps as Record<string, unknown>[])[1].data as Record<
      string,
      unknown
    >;
    (
      (terms.acceptedTerms as Record<string, unknown>).validation as Record<string, unknown>
    ).manyOf = [true];
    expectInvalid(booleanManyOf, 'INVALID_VALUE');
  });

  it('rejects invalid statuses and terminal shapes', () => {
    const status = workflow();
    (status.steps as Record<string, unknown>[])[0].status = 'pending';
    expectInvalid(status, 'INVALID_VALUE');

    const terminalData = workflow();
    (terminalData.steps as Record<string, unknown>[])[1].status = 'approved';
    expectInvalid(terminalData, 'INVALID_TERMINAL_STEP');

    const terminalTransition = workflow();
    (terminalTransition.steps as Record<string, unknown>[])[2].transitions = [
      { status: 'success', target: 'collect_email' },
    ];
    expectInvalid(terminalTransition, 'INVALID_TERMINAL_STEP');

    const terminalInitial = workflow();
    terminalInitial.initial = 'approved';
    expectInvalid(terminalInitial, 'INVALID_TERMINAL_STEP');
  });

  it('rejects duplicate field names across the flat context', () => {
    const input = workflow();
    const secondData = (input.steps as Record<string, unknown>[])[1].data as Record<
      string,
      unknown
    >;
    secondData.email = {
      type: 'string',
      required: true,
      validation: { format: 'email' },
    };

    expectInvalid(input, 'DUPLICATE_FIELD_NAME');
  });
});
