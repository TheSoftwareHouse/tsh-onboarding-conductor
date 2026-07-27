declare const require: (moduleName: string) => unknown;
declare const process: { cwd: () => string };

import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '.';

const baseWorkflowFixture: Record<string, unknown> = {
  id: 'base',
  version: 1,
  name: 'Base',
  initial: 'collect_email',
  webhook: {
    notify: {
      path: 'onboarding/root',
    },
  },
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
  it('normalizes valid root webhook declarations', () => {
    const input = workflow();

    (input.webhook as Record<string, unknown>).notify = {
      path: 'onboarding/collect_email',
    };
    (
      ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
        .transitions as Record<string, unknown>[]
    )[0].webhook = { notify: false };

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.webhook).toEqual({
      notify: {
        path: 'onboarding/collect_email',
      },
    });
    expect(normalized.stepsByName.collect_email.transitions).toEqual([
      {
        status: 'success',
        target: 'accept_terms',
        webhook: {
          notify: false,
        },
      },
    ]);
  });

  it('keeps root webhook declaration optional', () => {
    const input = workflow();
    delete input.webhook;

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.webhook).toBeUndefined();
  });

  it('normalizes the default fixture root webhook path', () => {
    const normalized = validateAndNormalizeWorkflow(workflow());

    expect(normalized.webhook).toEqual({
      notify: {
        path: 'onboarding/root',
      },
    });
  });

  it('normalizes transition-level notify opt-out declarations', () => {
    const input = workflow();
    (
      ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
        .transitions as Record<string, unknown>[]
    )[0].webhook = { notify: false };

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.transitions[0]).toEqual({
      status: 'success',
      target: 'accept_terms',
      webhook: {
        notify: false,
      },
    });
  });

  it('keeps transition webhook declarations optional', () => {
    const normalized = validateAndNormalizeWorkflow(workflow());

    expect(normalized.stepsByName.collect_email.transitions[0]).toEqual({
      status: 'success',
      target: 'accept_terms',
    });
    expect(normalized.stepsByName.accept_terms.transitions[0]).toEqual({
      status: 'success',
      target: 'approved',
    });
  });

  it('accepts root webhook with nested notify path segments', () => {
    const input = workflow();
    input.webhook = {
      notify: {
        path: 'onboarding/state_changed',
      },
    };

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.webhook).toEqual({
      notify: {
        path: 'onboarding/state_changed',
      },
    });
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

  it('treats invalid as a terminal status with no data or transitions', () => {
    const input = workflow();
    const steps = input.steps as Record<string, unknown>[];
    steps.push({ name: 'invalid', status: 'invalid', data: {}, transitions: [] });

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.invalid).toMatchObject({
      status: 'invalid',
      terminal: true,
      transitions: [],
    });
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
        method: 'verify',
        canReject: false,
        order: 2,
        fieldMapping: { email_in: 'email' },
        config: {},
      },
      {
        name: 'second',
        type: 'tsh_kyc',
        method: 'verify',
        canReject: false,
        order: 10,
        fieldMapping: { email_out: 'email' },
        config: {},
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
        method: 'verify',
        canReject: false,
        order: 1,
        fieldMapping: { email: 'email', acceptedTerms: 'acceptedTerms' },
        config: {},
      },
    ]);
  });

  it('accepts otp method declarations with required config and required rejected transition', () => {
    const input = workflow();
    input.initial = 'request_code';
    input.steps = [
      {
        name: 'request_code',
        status: 'awaiting_user',
        data: {
          email: {
            type: 'text',
            required: true,
            validation: { format: 'email' },
          },
        },
        connectors: [
          {
            name: 'mock_email_otp',
            type: 'mock_email_otp',
            method: 'generateCode',
            order: 1,
            fieldMapping: { recipient: 'email' },
            config: { codeLength: 6, ttlSeconds: 90 },
          },
        ],
        transitions: [{ status: 'success', target: 'verify_code' }],
      },
      {
        name: 'verify_code',
        status: 'awaiting_user',
        data: {
          verificationCode: {
            type: 'text',
            required: true,
            validation: { minLength: 1 },
          },
        },
        connectors: [
          {
            name: 'mock_email_otp',
            type: 'mock_email_otp',
            method: 'verifyCode',
            canReject: true,
            order: 1,
            fieldMapping: { code: 'verificationCode' },
            config: { maxAttempts: 3 },
          },
        ],
        transitions: [
          { status: 'success', target: 'approved' },
          { status: 'rejected', target: 'rejected' },
        ],
      },
      { name: 'approved', status: 'approved', data: {}, transitions: [] },
      { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
    ];

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.request_code.connectors).toEqual([
      {
        name: 'mock_email_otp',
        type: 'mock_email_otp',
        method: 'generateCode',
        canReject: false,
        order: 1,
        fieldMapping: { recipient: 'email' },
        config: { codeLength: 6, ttlSeconds: 90 },
      },
    ]);
    expect(normalized.stepsByName.verify_code.connectors).toEqual([
      {
        name: 'mock_email_otp',
        type: 'mock_email_otp',
        method: 'verifyCode',
        canReject: true,
        order: 1,
        fieldMapping: { code: 'verificationCode' },
        config: { maxAttempts: 3 },
      },
    ]);
  });

  it('requires rejected transition for any connector declaring canReject true, including non-verifyCode methods', () => {
    const input = workflow();
    input.initial = 'collect_email';
    input.steps = [
      {
        name: 'collect_email',
        status: 'awaiting_user',
        data: {
          email: {
            type: 'text',
            required: true,
            validation: { format: 'email' },
          },
        },
        connectors: [
          {
            name: 'kyc',
            type: 'mock_kyc_1',
            method: 'verify',
            canReject: true,
            order: 1,
            fieldMapping: { email: 'email' },
          },
        ],
        transitions: [
          { status: 'success', target: 'approved' },
          { status: 'rejected', target: 'rejected' },
        ],
      },
      { name: 'approved', status: 'approved', data: {}, transitions: [] },
      { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
    ];

    const normalized = validateAndNormalizeWorkflow(input);
    expect(normalized.stepsByName.collect_email.connectors).toEqual([
      {
        name: 'kyc',
        type: 'mock_kyc_1',
        method: 'verify',
        canReject: true,
        order: 1,
        fieldMapping: { email: 'email' },
        config: {},
      },
    ]);
  });

  it('rejects rejected transitions as unreachable when no connector declares canReject true', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0] as Record<string, unknown>;
    firstStep.connectors = [
      {
        name: 'kyc',
        type: 'mock_kyc_1',
        order: 1,
        fieldMapping: { email: 'email' },
      },
    ];
    firstStep.transitions = [
      { status: 'success', target: 'accept_terms' },
      { status: 'rejected', target: 'rejected' },
    ];
    (input.steps as Record<string, unknown>[]).push({
      name: 'rejected',
      status: 'rejected',
      data: {},
      transitions: [],
    });

    expectInvalid(input, 'INVALID_TRANSITIONS');
  });

  it.each(['manual.approve', 'manual.reject', 'manual.invalid'])(
    'rejects a targetless %s transition with INVALID_SHAPE',
    (status) => {
      const input = workflow();
      const steps = input.steps as Record<string, unknown>[];
      const reviewStep = steps[1] as Record<string, unknown>;
      reviewStep.name = 'review_documents';
      reviewStep.status = 'awaiting_manual_review';
      reviewStep.transitions = [{ status }];

      expectInvalid(input, 'INVALID_SHAPE');
    },
  );

  it.each(['manual.approve', 'manual.reject', 'manual.invalid'])(
    'rejects a self-target %s transition with INVALID_TRANSITIONS',
    (status) => {
      const input = workflow();
      const steps = input.steps as Record<string, unknown>[];
      const collectStep = steps[0] as Record<string, unknown>;
      const reviewStep = steps[1] as Record<string, unknown>;
      reviewStep.name = 'review_documents';
      reviewStep.status = 'awaiting_manual_review';
      reviewStep.transitions = [{ status, target: 'review_documents' }];
      collectStep.transitions = [{ status: 'success', target: 'review_documents' }];

      expectInvalid(input, 'INVALID_TRANSITIONS');
    },
  );

  it('accepts generic targetless and self-target non-manual transitions', () => {
    const input = workflow();
    const steps = input.steps as Record<string, unknown>[];
    const collectStep = steps[0] as Record<string, unknown>;
    const reviewStep = steps[1] as Record<string, unknown>;
    reviewStep.name = 'review_documents';
    reviewStep.status = 'awaiting_manual_review';
    reviewStep.transitions = [
      { status: 'success' },
      { status: 'rejected', target: 'review_documents' },
    ];
    collectStep.transitions = [{ status: 'success', target: 'review_documents' }];

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.review_documents.transitions).toEqual([
      { status: 'success' },
      { status: 'rejected', target: 'review_documents' },
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

  it('accepts the representative email and sms otp workflow fixtures with verifyCode success/rejected transitions only', () => {
    const fs = require('fs') as { readFileSync: (path: string, encoding: string) => string };
    const workflowsDir = [process.cwd(), '..', '..', '..', 'workflows'].join('/');

    const emailInput = JSON.parse(
      fs.readFileSync(`${workflowsDir}/email-otp.workflow.json`, 'utf8'),
    ) as Record<string, unknown>;
    const smsInput = JSON.parse(
      fs.readFileSync(`${workflowsDir}/sms-otp.workflow.json`, 'utf8'),
    ) as Record<string, unknown>;

    const emailNormalized = validateAndNormalizeWorkflow(emailInput);
    const smsNormalized = validateAndNormalizeWorkflow(smsInput);

    expect(
      emailNormalized.stepsByName.verify_code.transitions.map(
        (transition: { status: string }) => transition.status,
      ),
    ).toEqual(['success', 'rejected']);
    expect(emailNormalized.stepsByName.verify_code.connectors[0]).toMatchObject({
      method: 'verifyCode',
      canReject: true,
    });
    expect(
      smsNormalized.stepsByName.verify_code.transitions.map(
        (transition: { status: string }) => transition.status,
      ),
    ).toEqual(['success', 'rejected']);
    expect(smsNormalized.stepsByName.verify_code.connectors[0]).toMatchObject({
      method: 'verifyCode',
      canReject: true,
    });
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
      'transition webhook',
      (input: Record<string, unknown>) => {
        (
          ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
            .transitions as Record<string, unknown>[]
        )[0].webhook = {
          notify: false,
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

    const transitionWebhook = workflow();
    (
      ((transitionWebhook.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
        .transitions as Record<string, unknown>[]
    )[0].webhook = 'not-an-object';
    expectInvalid(transitionWebhook, 'INVALID_SHAPE');
  });

  it.each([
    [
      'root missing notify',
      (input: Record<string, unknown>) => {
        input.webhook = {
          path: 'onboarding/state_changed',
        };
      },
      'INVALID_SHAPE',
    ],
    [
      'root missing path',
      (input: Record<string, unknown>) => {
        input.webhook = {
          notify: {},
        };
      },
      'INVALID_SHAPE',
    ],
    [
      'transition missing notify',
      (input: Record<string, unknown>) => {
        (
          ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
            .transitions as Record<string, unknown>[]
        )[0].webhook = {
          path: 'onboarding/state_changed',
        };
      },
      'INVALID_SHAPE',
    ],
    [
      'transition notify true',
      (input: Record<string, unknown>) => {
        (
          ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
            .transitions as Record<string, unknown>[]
        )[0].webhook = {
          notify: true,
        };
      },
      'INVALID_VALUE',
    ],
    [
      'transition notify object',
      (input: Record<string, unknown>) => {
        (
          ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
            .transitions as Record<string, unknown>[]
        )[0].webhook = {
          notify: {
            path: 'onboarding/state_changed',
          },
        };
      },
      'INVALID_VALUE',
    ],
    [
      'transition legacy eventType/path declaration',
      (input: Record<string, unknown>) => {
        (
          ((input.steps as Record<string, unknown>[])[0] as Record<string, unknown>)
            .transitions as Record<string, unknown>[]
        )[0].webhook = {
          eventType: 'onboarding.state_changed',
          path: 'onboarding/state_changed',
        };
      },
      'INVALID_SHAPE',
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
    input.webhook = {
      notify: {
        path,
      },
    };

    expectInvalid(input, 'INVALID_VALUE');
  });

  it('rejects step-level webhook declarations as unknown step properties', () => {
    const input = workflow();
    ((input.steps as Record<string, unknown>[])[2] as Record<string, unknown>).webhook = {
      notify: false,
    };

    expectInvalid(input, 'UNKNOWN_PROPERTY');
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
    [
      'legacy verify with non-empty config',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          {
            name: 'kyc',
            type: 'tsh_kyc',
            method: 'verify',
            order: 1,
            fieldMapping: { email: 'email' },
            config: { maxAttempts: 3 },
          },
        ];
      },
      'INVALID_VALUE',
    ],
    [
      'generateCode without recipient mapping',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          {
            name: 'otp',
            type: 'mock_email_otp',
            method: 'generateCode',
            order: 1,
            fieldMapping: { email: 'email' },
            config: { codeLength: 6, ttlSeconds: 120 },
          },
        ];
      },
      'INVALID_VALUE',
    ],
    [
      'verifyCode without code mapping',
      (input: Record<string, unknown>) => {
        input.initial = 'verify';
        input.steps = [
          {
            name: 'verify',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                canReject: true,
                order: 1,
                fieldMapping: { verificationCode: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ];
      },
      'INVALID_VALUE',
    ],
    [
      'verifyCode missing rejected transition',
      (input: Record<string, unknown>) => {
        input.initial = 'verify';
        input.steps = [
          {
            name: 'verify',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ];
      },
      'INVALID_TRANSITIONS',
    ],
    [
      'verifyCode with non-terminal rejected target',
      (input: Record<string, unknown>) => {
        input.initial = 'verify';
        input.steps = [
          {
            name: 'verify',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'otp',
                type: 'mock_email_otp',
                method: 'verifyCode',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                config: { maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'verify' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ];
      },
      'INVALID_TRANSITIONS',
    ],
    [
      'connector canReject is not boolean',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          {
            name: 'kyc',
            type: 'tsh_kyc',
            method: 'verify',
            canReject: 'yes',
            order: 1,
            fieldMapping: { email: 'email' },
          },
        ];
      },
      'INVALID_SHAPE',
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
