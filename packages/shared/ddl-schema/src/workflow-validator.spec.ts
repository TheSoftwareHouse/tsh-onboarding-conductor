declare const require: (moduleName: string) => unknown;
declare const process: { cwd: () => string };

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
  it('normalizes valid source webhook declarations', () => {
    const input = workflow();

    const firstStep = (input.steps as Record<string, unknown>[])[0];
    firstStep.webhook = {
      eventType: 'onboarding.state_changed',
      path: 'onboarding/collect_email',
    };

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.webhook).toEqual({
      eventType: 'onboarding.state_changed',
      path: 'onboarding/collect_email',
    });
    expect(normalized.stepsByName.accept_terms.webhook).toBeUndefined();
  });

  it('keeps step webhook declarations optional', () => {
    const normalized = validateAndNormalizeWorkflow(workflow());

    expect(normalized.stepsByName.collect_email.webhook).toBeUndefined();
    expect(normalized.stepsByName.accept_terms.webhook).toBeUndefined();
  });

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

  it('accepts review steps with manual transitions and targetless recursive transitions', () => {
    const input = workflow();
    const steps = input.steps as Record<string, unknown>[];
    const reviewStep = steps[1] as Record<string, unknown>;
    reviewStep.name = 'review_documents';
    reviewStep.status = 'awaiting_manual_review';
    reviewStep.transitions = [
      { status: 'manual.approve', target: 'approved' },
      { status: 'manual.reject', target: 'rejected' },
      { status: 'manual.return', target: 'collect_email' },
    ];

    const collectStep = steps[0] as Record<string, unknown>;
    collectStep.transitions = [{ status: 'success' }, { status: 'manual.return' }];

    const rejected = {
      name: 'rejected',
      status: 'rejected',
      data: {},
      transitions: [],
    };
    steps.push(rejected);

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.review_documents).toMatchObject({
      status: 'awaiting_manual_review',
      terminal: false,
    });
    expect(normalized.stepsByName.review_documents.transitions).toEqual([
      { status: 'manual.approve', target: 'approved' },
      { status: 'manual.reject', target: 'rejected' },
      { status: 'manual.return', target: 'collect_email' },
    ]);
    expect(normalized.stepsByName.collect_email.transitions).toEqual([
      { status: 'success' },
      { status: 'manual.return' },
    ]);
    expect(normalized.stepsByName.rejected.terminal).toBe(true);
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

  it('accepts a larger workflow-defined file descriptor mixed with a sibling text field', () => {
    const input = workflow();
    const step = (input.steps as Record<string, unknown>[])[0];
    const data = step.data as Record<string, unknown>;

    data.identityDocument = {
      type: 'file',
      required: true,
      validation: {
        contentTypes: ['image/png', 'image/jpeg'],
        maxSizeBytes: 16777216,
        maxImageWidth: 4096,
        maxImageHeight: 4096,
      },
    };
    data.documentLabel = {
      type: 'text',
      required: true,
      validation: {
        minLength: 1,
      },
    };

    const normalized = validateAndNormalizeWorkflow(input);
    expect(normalized.stepsByName.collect_email.data.identityDocument).toMatchObject({
      type: 'file',
      required: true,
      validation: {
        maxSizeBytes: 16777216,
      },
    });
  });

  it('rejects an unsafe overflow size above the safe-integer boundary', () => {
    const input = workflow();
    const step = (input.steps as Record<string, unknown>[])[0];
    const data = step.data as Record<string, unknown>;

    data.identityDocument = {
      type: 'file',
      required: true,
      validation: {
        contentTypes: ['image/png'],
        maxSizeBytes: 9007199254740992,
      },
    };

    expectInvalid(input, 'INVALID_VALUE');
  });

  it('accepts workflow-defined content types such as application/zip and normalizes them', () => {
    const input = workflow();
    const step = (input.steps as Record<string, unknown>[])[0];
    const data = step.data as Record<string, unknown>;

    data.identityDocument = {
      type: 'file',
      required: true,
      validation: {
        contentTypes: ['application/zip', '  APPLICATION/ZIP  '],
        maxSizeBytes: 1024,
      },
    };

    expect(() => validateAndNormalizeWorkflow(input)).toThrow(WorkflowInvalidError);

    const normalizedInput = workflow();
    const normalizedStep = (normalizedInput.steps as Record<string, unknown>[])[0];
    const normalizedData = normalizedStep.data as Record<string, unknown>;
    normalizedData.identityDocument = {
      type: 'file',
      required: true,
      validation: {
        contentTypes: ['application/zip'],
        maxSizeBytes: 1024,
      },
    };

    const normalized = validateAndNormalizeWorkflow(normalizedInput);
    expect(normalized.stepsByName.collect_email.data.identityDocument).toMatchObject({
      type: 'file',
      required: true,
      validation: {
        contentTypes: ['application/zip'],
        maxSizeBytes: 1024,
      },
    });
  });

  it('accepts the representative file-upload workflow fixture', () => {
    const fs = require('fs') as { readFileSync: (path: string, encoding: string) => string };
    const workflowPath = [
      process.cwd(),
      '..',
      '..',
      '..',
      'workflows',
      'file-upload.workflow.json',
    ].join('/');
    const input = JSON.parse(fs.readFileSync(workflowPath, 'utf8')) as Record<string, unknown>;
    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.id).toBe('file-upload');
    expect(normalized.stepsByName.collect_identity.data.identityDocument).toMatchObject({
      type: 'file',
      required: true,
    });
    expect(normalized.stepsByName.collect_identity.data.documentLabel).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(normalized.stepsByName.approved.terminal).toBe(true);
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
      'step webhook',
      (input: Record<string, unknown>) => {
        ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>).webhook = {
          eventType: 'onboarding.state_changed',
          path: 'onboarding/state_changed',
          unexpected: true,
        };
      },
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

    const stepWebhook = workflow();
    ((stepWebhook.steps as Record<string, unknown>[])[0] as Record<string, unknown>).webhook =
      'not-an-object';
    expectInvalid(stepWebhook, 'INVALID_SHAPE');
  });

  it.each([
    [
      'step missing eventType',
      (input: Record<string, unknown>) => {
        ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>).webhook = {
          path: 'onboarding/state_changed',
        };
      },
      'INVALID_SHAPE',
    ],
    [
      'step missing path',
      (input: Record<string, unknown>) => {
        ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>).webhook = {
          eventType: 'onboarding.state_changed',
        };
      },
      'INVALID_SHAPE',
    ],
    [
      'unsupported step event type',
      (input: Record<string, unknown>) => {
        ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>).webhook = {
          eventType: 'onboarding.unknown',
          path: 'onboarding/state_changed',
        };
      },
      'INVALID_VALUE',
    ],
    [
      'step rejects created event',
      (input: Record<string, unknown>) => {
        ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>).webhook = {
          eventType: 'onboarding.created',
          path: 'onboarding/created',
        };
      },
      'INVALID_VALUE',
    ],
  ])('rejects invalid webhook structure for %s', (_label, mutate, reason) => {
    const input = workflow();
    mutate(input);

    expectInvalid(input, reason);
  });

  it.each([
    ['blank path', ''],
    ['leading whitespace', ' onboarding/path'],
    ['trailing whitespace', 'onboarding/path '],
    ['only whitespace', '   '],
    ['leading slash', '/onboarding/path'],
    ['trailing slash', 'onboarding/path/'],
    ['double slash', 'onboarding//path'],
    ['dot segment', './path'],
    ['dot dot segment', '../path'],
    ['contains dot segment in middle', 'onboarding/./path'],
    ['contains dot dot segment in middle', 'onboarding/../path'],
    ['backslash', 'onboarding\\path'],
    ['percent encoding', 'onboarding/%2Fpath'],
    ['absolute url', 'https://example.com/webhook'],
    ['protocol-like', 'https:onboarding/path'],
    ['host-like authority', '//example.com/path'],
    ['query delimiter', 'onboarding/path?ok=true'],
    ['fragment delimiter', 'onboarding/path#fragment'],
    ['credentials-like', 'user@host/path'],
    ['non-ascii unicode', 'onboarding/żółć'],
  ])('rejects invalid webhook path: %s', (_label, path) => {
    const input = workflow();
    ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>).webhook = {
      eventType: 'onboarding.state_changed',
      path,
    };

    expectInvalid(input, 'INVALID_VALUE');
  });

  it('rejects webhook declaration on terminal step', () => {
    const input = workflow();
    ((input.steps as Record<string, unknown>[])[2] as Record<string, unknown>).webhook = {
      eventType: 'onboarding.state_changed',
      path: 'onboarding/approved',
    };

    expectInvalid(input, 'INVALID_TERMINAL_STEP');
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

  it('rejects duplicate, unsupported, blank, and unknown transition targets', () => {
    const duplicate = workflow();
    const firstTransitions = (duplicate.steps as Record<string, unknown>[])[0]
      .transitions as Record<string, unknown>[];
    firstTransitions.push({ status: 'success', target: 'accept_terms' });
    expectInvalid(duplicate, 'DUPLICATE_TRANSITION');

    const unsupported = workflow();
    (
      (unsupported.steps as Record<string, unknown>[])[0].transitions as Record<string, unknown>[]
    )[0].status = 'manual.fail';
    expectInvalid(unsupported, 'INVALID_VALUE');

    const blank = workflow();
    (
      (blank.steps as Record<string, unknown>[])[0].transitions as Record<string, unknown>[]
    )[0].target = ' ';
    expectInvalid(blank, 'INVALID_VALUE');

    const unknown = workflow();
    (
      (unknown.steps as Record<string, unknown>[])[0].transitions as Record<string, unknown>[]
    )[0].target = 'missing';
    expectInvalid(unknown, 'UNKNOWN_TARGET');
  });

  it('rejects empty transitions on awaiting states and non-empty terminal shapes', () => {
    const awaiting = workflow();
    (awaiting.steps as Record<string, unknown>[])[0].status = 'awaiting_manual_review';
    (awaiting.steps as Record<string, unknown>[])[0].transitions = [];
    expectInvalid(awaiting, 'INVALID_TRANSITIONS');

    const terminalData = workflow();
    (terminalData.steps as Record<string, unknown>[])[2].status = 'approved';
    (terminalData.steps as Record<string, unknown>[])[2].data = {
      reason: {
        type: 'text',
        required: true,
        validation: { minLength: 1 },
      },
    };
    expectInvalid(terminalData, 'INVALID_TERMINAL_STEP');

    const terminalTransition = workflow();
    (terminalTransition.steps as Record<string, unknown>[])[2].status = 'rejected';
    (terminalTransition.steps as Record<string, unknown>[])[2].transitions = [
      { status: 'success', target: 'collect_email' },
    ];
    expectInvalid(terminalTransition, 'INVALID_TERMINAL_STEP');
  });

  it('accepts terminal rejected steps alongside terminal approved steps', () => {
    const input = workflow();
    const rejected = {
      name: 'rejected',
      status: 'rejected',
      data: {},
      transitions: [],
    };
    (input.steps as Record<string, unknown>[]).push(rejected);

    const normalized = validateAndNormalizeWorkflow(input);
    expect(normalized.stepsByName.approved.terminal).toBe(true);
    expect(normalized.stepsByName.rejected.terminal).toBe(true);
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

  it.each([
    [
      'duplicate mime values',
      (input: Record<string, unknown>) => {
        const data = (input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>;
        data.identityDocument = {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/png'],
            maxSizeBytes: 1024,
          },
        };
      },
    ],
    [
      'blank content type entry',
      (input: Record<string, unknown>) => {
        const data = (input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>;
        data.identityDocument = {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['application/zip', '   '],
            maxSizeBytes: 1024,
          },
        };
      },
    ],
    [
      'non-image dimensions',
      (input: Record<string, unknown>) => {
        const data = (input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>;
        data.identityDocument = {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['application/pdf'],
            maxSizeBytes: 1024,
            maxImageWidth: 200,
          },
        };
      },
    ],
    [
      'unsafe overflow size',
      (input: Record<string, unknown>) => {
        const data = (input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>;
        data.identityDocument = {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png'],
            maxSizeBytes: 9007199254740992,
          },
        };
      },
    ],
    [
      'multiple file fields',
      (input: Record<string, unknown>) => {
        const data = (input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>;
        data.identityDocument = {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png'],
            maxSizeBytes: 1024,
          },
        };
        data.identityDocumentBackup = {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/jpeg'],
            maxSizeBytes: 1024,
          },
        };
      },
    ],
    [
      'optional file field',
      (input: Record<string, unknown>) => {
        const data = (input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>;
        data.identityDocument = {
          type: 'file',
          required: false,
          validation: {
            contentTypes: ['image/png'],
            maxSizeBytes: 1024,
          },
        };
      },
    ],
  ])('rejects invalid file configuration: %s', (_label, mutate) => {
    const input = workflow();
    mutate(input);
    expectInvalid(input, 'INVALID_VALUE');
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
