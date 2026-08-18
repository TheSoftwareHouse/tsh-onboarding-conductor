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
        canReject: false,
        async: false,
        order: 2,
        fieldMapping: { email_in: 'email' },
        config: {},
      },
      {
        name: 'second',
        type: 'tsh_kyc',
        canReject: false,
        async: false,
        order: 10,
        fieldMapping: { email_out: 'email' },
        config: {},
      },
    ]);
    expect(normalized.stepsByName.accept_terms.connectors).toEqual([]);
  });

  it('preserves connector config as opaque adapter-owned data', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0];
    const opaqueConfig = {
      operation: 'unknown-operation',
      nested: {
        allow: true,
        retries: 3,
      },
      list: ['a', 2, false, null, { deep: ['x'] }],
      nullable: null,
    };

    firstStep.connectors = [
      {
        name: 'implicit',
        type: 'tsh_kyc',
        order: 2,
        fieldMapping: { email_in: 'email' },
      },
      {
        name: 'opaque',
        type: 'tsh_kyc',
        order: 1,
        fieldMapping: { email_out: 'email' },
        config: opaqueConfig,
      },
    ];

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.connectors).toEqual([
      {
        name: 'opaque',
        type: 'tsh_kyc',
        canReject: false,
        async: false,
        order: 1,
        fieldMapping: { email_out: 'email' },
        config: opaqueConfig,
      },
      {
        name: 'implicit',
        type: 'tsh_kyc',
        canReject: false,
        async: false,
        order: 2,
        fieldMapping: { email_in: 'email' },
        config: {},
      },
    ]);
  });

  it('allows cross-step connector mappings from a guaranteed predecessor, including conditional predecessor fields', () => {
    const input = workflow();
    input.initial = 'collect_country';
    input.steps = [
      {
        name: 'collect_country',
        status: 'awaiting_user',
        data: {
          country: {
            type: 'text',
            required: true,
          },
          taxId: {
            type: 'text',
            required: true,
            when: { field: 'country', equals: 'US' },
          },
        },
        transitions: [{ status: 'success', target: 'collect_details' }],
      },
      {
        name: 'collect_details',
        status: 'awaiting_user',
        data: {
          acceptedTerms: {
            type: 'boolean',
            required: true,
            validation: { oneOf: [true] },
          },
        },
        connectors: [
          {
            name: 'cross_step',
            type: 'tsh_kyc_2',
            order: 1,
            fieldMapping: {
              country: 'country',
              taxId: 'taxId',
              acceptedTerms: 'acceptedTerms',
            },
          },
        ],
        transitions: [{ status: 'success', target: 'approved' }],
      },
      {
        name: 'approved',
        status: 'approved',
        data: {},
        transitions: [],
      },
    ];

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_details.connectors).toEqual([
      {
        name: 'cross_step',
        type: 'tsh_kyc_2',
        canReject: false,
        async: false,
        order: 1,
        fieldMapping: {
          country: 'country',
          taxId: 'taxId',
          acceptedTerms: 'acceptedTerms',
        },
        config: {},
      },
    ]);
  });

  it('rejects connector mappings sourced from a future step field', () => {
    const input = workflow();
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
            name: 'future_source',
            type: 'tsh_kyc',
            order: 1,
            fieldMapping: {
              acceptedTerms: 'acceptedTerms',
            },
          },
        ],
        transitions: [{ status: 'success', target: 'accept_terms' }],
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
        transitions: [{ status: 'success', target: 'approved' }],
      },
      {
        name: 'approved',
        status: 'approved',
        data: {},
        transitions: [],
      },
    ];

    expectInvalid(input, 'INVALID_VALUE');
  });

  it('rejects connector mappings sourced from a non-dominating branch step field', () => {
    const input = workflow();
    input.initial = 'select_branch';
    input.steps = [
      {
        name: 'select_branch',
        status: 'awaiting_user',
        data: {
          branch: {
            type: 'text',
            required: true,
            validation: { oneOf: ['left', 'right'] },
          },
        },
        transitions: [
          {
            status: 'success',
            when: { field: 'branch', equals: 'left' },
            target: 'left_step',
          },
          { status: 'success', target: 'right_step' },
        ],
      },
      {
        name: 'left_step',
        status: 'awaiting_user',
        data: {
          leftCode: {
            type: 'text',
            required: false,
          },
        },
        transitions: [{ status: 'success', target: 'collect_review' }],
      },
      {
        name: 'right_step',
        status: 'awaiting_user',
        data: {
          rightCode: {
            type: 'text',
            required: false,
          },
        },
        transitions: [{ status: 'success', target: 'collect_review' }],
      },
      {
        name: 'collect_review',
        status: 'awaiting_user',
        data: {
          reviewToken: {
            type: 'text',
            required: true,
          },
        },
        connectors: [
          {
            name: 'branch_source',
            type: 'tsh_kyc',
            order: 1,
            fieldMapping: {
              leftCode: 'leftCode',
              reviewToken: 'reviewToken',
            },
          },
        ],
        transitions: [{ status: 'success', target: 'approved' }],
      },
      {
        name: 'approved',
        status: 'approved',
        data: {},
        transitions: [],
      },
    ];

    expectInvalid(input, 'INVALID_VALUE');
  });

  it('rejects connector mappings sourced from a persist:false predecessor field', () => {
    const input = workflow();
    input.initial = 'collect_country';
    input.steps = [
      {
        name: 'collect_country',
        status: 'awaiting_user',
        data: {
          country: {
            type: 'text',
            required: true,
          },
          ephemeralCode: {
            type: 'text',
            required: false,
            persist: false,
          },
        },
        transitions: [{ status: 'success', target: 'collect_details' }],
      },
      {
        name: 'collect_details',
        status: 'awaiting_user',
        data: {
          acceptedTerms: {
            type: 'boolean',
            required: true,
            validation: { oneOf: [true] },
          },
        },
        connectors: [
          {
            name: 'persist_false_source',
            type: 'tsh_kyc_2',
            order: 1,
            fieldMapping: {
              ephemeralCode: 'ephemeralCode',
              acceptedTerms: 'acceptedTerms',
            },
          },
        ],
        transitions: [{ status: 'success', target: 'approved' }],
      },
      {
        name: 'approved',
        status: 'approved',
        data: {},
        transitions: [],
      },
    ];

    expectInvalid(input, 'INVALID_VALUE');
  });

  it('does not require operation-specific field mapping at shared validation level', () => {
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
            order: 1,
            fieldMapping: { emailValue: 'email' },
            config: { operation: 'generateCode', codeLength: 6, ttlSeconds: 90 },
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
            canReject: true,
            order: 1,
            fieldMapping: { verificationCodeValue: 'verificationCode' },
            config: { operation: 'verifyCode', maxAttempts: 3 },
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
        canReject: false,
        async: false,
        order: 1,
        fieldMapping: { emailValue: 'email' },
        config: { operation: 'generateCode', codeLength: 6, ttlSeconds: 90 },
      },
    ]);
    expect(normalized.stepsByName.verify_code.connectors).toEqual([
      {
        name: 'mock_email_otp',
        type: 'mock_email_otp',
        canReject: true,
        async: false,
        order: 1,
        fieldMapping: { verificationCodeValue: 'verificationCode' },
        config: { operation: 'verifyCode', maxAttempts: 3 },
      },
    ]);
  });

  it('accepts and preserves arbitrary JSON-compatible connector config values', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0];
    const opaqueConfig = {
      operation: 'private-adapter-op',
      nested: {
        x: 1,
        y: true,
        z: null,
      },
      list: [1, 'two', false, null, { deep: ['ok'] }],
      enabled: true,
      threshold: 2.5,
      note: 'value',
      nullable: null,
    };

    firstStep.connectors = [
      {
        name: 'opaque_config',
        type: 'mock_kyc_1',
        order: 1,
        fieldMapping: { email: 'email' },
        config: opaqueConfig,
      },
    ];

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.connectors[0]).toEqual({
      name: 'opaque_config',
      type: 'mock_kyc_1',
      canReject: false,
      async: false,
      order: 1,
      fieldMapping: { email: 'email' },
      config: opaqueConfig,
    });
  });

  it('requires rejected transition for any connector declaring canReject true', () => {
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
        canReject: true,
        async: false,
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

  it('applies the rejected self-loop rule the same way with and without a non-rejecting connector', () => {
    const withoutConnector = workflow();
    const firstStep = (withoutConnector.steps as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    firstStep.transitions = [
      { status: 'success', target: 'accept_terms' },
      { status: 'rejected', target: 'collect_email' },
    ];

    const withConnector = structuredClone(withoutConnector);
    ((withConnector.steps as Record<string, unknown>[])[0] as Record<string, unknown>).connectors =
      [
        {
          name: 'kyc',
          type: 'mock_kyc_1',
          order: 1,
          fieldMapping: { email: 'email' },
        },
      ];

    for (const input of [withoutConnector, withConnector]) {
      const normalized = validateAndNormalizeWorkflow(input);

      expect(normalized.stepsByName.collect_email.transitions).toEqual([
        { status: 'success', target: 'accept_terms' },
        { status: 'rejected', target: 'collect_email' },
      ]);
    }
  });

  it('defaults initial to the first ordered step', () => {
    const input = workflow();
    delete input.initial;

    expect(validateAndNormalizeWorkflow(input).initial).toBe('collect_email');
  });

  it('normalizes account-number scalar conditions with equals and in literals', () => {
    const input = workflow();
    const step = (input.steps as Record<string, unknown>[])[0];
    const data = step.data as Record<string, unknown>;

    data.accountNumber = {
      type: 'text',
      required: false,
      validation: {
        format: 'account-number',
      },
    };
    data.displayName = {
      type: 'text',
      required: false,
      when: {
        field: 'accountNumber',
        in: ['DE89 3704 0044 0532 0130 00', 'GB82 WEST 1234 5698 7654 32'],
      },
    };

    const normalized = validateAndNormalizeWorkflow(input);
    const fieldData = normalized.stepsByName.collect_email.data;

    expect(fieldData.displayName).toMatchObject({
      type: 'text',
      required: false,
      when: {
        field: 'accountNumber',
        in: ['DE89 3704 0044 0532 0130 00', 'GB82 WEST 1234 5698 7654 32'],
      },
    });
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
    expect(fieldData.displayName).toMatchObject({ persist: true });
    expect(fieldData.score).toMatchObject({ persist: true });
    expect(fieldData.startedAt).toMatchObject({ persist: true });
    expect(fieldData.featureFlag).toMatchObject({ persist: true });
  });

  it('keeps persist false when explicitly declared on any field descriptor', () => {
    const input = workflow();
    const step = (input.steps as Record<string, unknown>[])[0];
    const data = step.data as Record<string, unknown>;

    data.email = {
      ...(data.email as Record<string, unknown>),
      persist: false,
    };

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.data.email).toMatchObject({
      type: 'text',
      persist: false,
    });
  });

  it('rejects non-boolean persist values', () => {
    const input = workflow();
    const step = (input.steps as Record<string, unknown>[])[0];
    const data = step.data as Record<string, unknown>;

    data.email = {
      ...(data.email as Record<string, unknown>),
      persist: 'no',
    };

    expectInvalid(input, 'INVALID_SHAPE');
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
      'packages',
      'engine',
      'workflows',
      'fixtures',
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

  it('accepts the representative sendgrid email workflow fixture', () => {
    const fs = require('fs') as { readFileSync: (path: string, encoding: string) => string };
    const workflowPath = [
      process.cwd(),
      '..',
      '..',
      '..',
      'packages',
      'engine',
      'workflows',
      'fixtures',
      'sendgrid-email.workflow.json',
    ].join('/');
    const input = JSON.parse(fs.readFileSync(workflowPath, 'utf8')) as Record<string, unknown>;
    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.id).toBe('sendgrid-email');
    expect(normalized.stepsByName.send_email.data.email).toMatchObject({
      type: 'text',
      required: true,
      validation: {
        format: 'email',
      },
    });
    expect(normalized.stepsByName.send_email.data.emailTemplateId).toMatchObject({
      type: 'text',
      required: true,
      validation: {
        pattern: '^d-',
      },
    });
    expect(normalized.stepsByName.send_email.data.firstName).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(normalized.stepsByName.send_email.data.accountReference).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(normalized.stepsByName.send_email.data.companyName).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(normalized.stepsByName.send_email.connectors[0]).toMatchObject({
      type: 'sendgrid_email',
      fieldMapping: {
        recipient: 'email',
        templateId: 'emailTemplateId',
        'dynamicTemplateData.first_name': 'firstName',
        'dynamicTemplateData.account_reference': 'accountReference',
        'dynamicTemplateData.company_name': 'companyName',
      },
    });
    const sendgridConnector = normalized.stepsByName.send_email.connectors[0] as {
      fieldMapping: Record<string, string>;
    };
    expect(sendgridConnector.fieldMapping).not.toHaveProperty('subject');
    expect(sendgridConnector.fieldMapping).not.toHaveProperty('body');
    expect(normalized.stepsByName.approved.terminal).toBe(true);
  });

  it('accepts the representative email and sms otp workflow fixtures with config.operation and success/rejected transitions', () => {
    const fs = require('fs') as { readFileSync: (path: string, encoding: string) => string };
    const workflowsDir = [
      process.cwd(),
      '..',
      '..',
      '..',
      'packages',
      'engine',
      'workflows',
      'fixtures',
    ].join('/');

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
      canReject: true,
      config: { operation: 'verifyCode', maxAttempts: 3 },
    });
    expect(emailNormalized.stepsByName.verify_code.data.verificationCode).toMatchObject({
      persist: false,
    });
    expect(
      smsNormalized.stepsByName.verify_code.transitions.map(
        (transition: { status: string }) => transition.status,
      ),
    ).toEqual(['success', 'rejected']);
    expect(smsNormalized.stepsByName.verify_code.connectors[0]).toMatchObject({
      canReject: true,
      config: { operation: 'verifyCode', maxAttempts: 3 },
    });
    expect(smsNormalized.stepsByName.verify_code.data.verificationCode).toMatchObject({
      persist: false,
    });
  });

  it('accepts the representative manual smtp workflow fixture', () => {
    const fs = require('fs') as { readFileSync: (path: string, encoding: string) => string };
    const workflowPath = [
      process.cwd(),
      '..',
      '..',
      '..',
      'packages',
      'engine',
      'workflows',
      'fixtures',
      'manual-smtp.workflow.json',
    ].join('/');
    const input = JSON.parse(fs.readFileSync(workflowPath, 'utf8')) as Record<string, unknown>;
    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.id).toBe('manual-smtp');
    expect(normalized.stepsByName.collect_message.connectors[0]).toMatchObject({
      type: 'smtp_email',
      fieldMapping: {
        recipient: 'recipient',
        subject: 'subject',
        firstName: 'firstName',
      },
      config: {
        templatePath: 'manual-smtp.html',
      },
    });
    expect(normalized.stepsByName.collect_message.data.recipient).toMatchObject({
      type: 'text',
      required: true,
      validation: {
        format: 'email',
      },
    });
    expect(normalized.stepsByName.collect_message.data.subject).toMatchObject({
      type: 'text',
      required: true,
      validation: {
        maxLength: 998,
      },
    });
    expect(normalized.stepsByName.collect_message.data.firstName).toMatchObject({
      type: 'text',
      required: true,
      validation: {
        maxLength: 200,
      },
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
      'legacy top-level connector method',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          {
            name: 'otp',
            type: 'mock_email_otp',
            method: 'verify',
            order: 1,
            fieldMapping: { email: 'email' },
            config: {},
          },
        ];
      },
      'UNKNOWN_PROPERTY',
    ],
    [
      'connector config must be a plain object',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          {
            name: 'otp',
            type: 'mock_email_otp',
            order: 1,
            fieldMapping: { email: 'email' },
            config: ['not-object'],
          },
        ];
      },
      'INVALID_SHAPE',
    ],
    [
      'connector config contains non-json-compatible values',
      (input: Record<string, unknown>) => {
        const step = (input.steps as Record<string, unknown>[])[0];
        step.connectors = [
          {
            name: 'otp',
            type: 'mock_email_otp',
            order: 1,
            fieldMapping: { email: 'email' },
            config: {
              operation: 'unknown-private-op',
              invalidUndefined: undefined,
            },
          },
        ];
      },
      'INVALID_SHAPE',
    ],
    [
      'connector with canReject true missing rejected transition',
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
                canReject: true,
                order: 1,
                fieldMapping: { verificationCode: 'verificationCode' },
                config: { operation: 'private-op', anything: true },
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
      'connector with canReject true and non-terminal rejected target',
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
                canReject: true,
                order: 1,
                fieldMapping: { verificationCode: 'verificationCode' },
                config: { operation: 'private-op', attempts: 99 },
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
    ['number below minimum', 'number', { minimum: 10, oneOf: [5] }],
    ['one number below minimum', 'number', { minimum: 10, oneOf: [5, 20] }],
    ['number above maximum', 'number', { maximum: 10, manyOf: [20] }],
    ['number on an exclusive bound', 'number', { exclusiveMinimum: 10, oneOf: [10] }],
    ['number on an exclusive upper bound', 'number', { exclusiveMaximum: 10, manyOf: [10] }],
    ['text shorter than minLength', 'text', { minLength: 3, oneOf: ['ab'] }],
    ['text longer than maxLength', 'text', { maxLength: 3, oneOf: ['abcd'] }],
    ['text failing the pattern', 'text', { pattern: '^a', manyOf: ['b'] }],
    ['one text entry failing the pattern', 'text', { pattern: '^a', oneOf: ['ab', 'b'] }],
  ])(
    'rejects a selection value no submitted value could satisfy: %s',
    (_label, type, validation) => {
      const input = workflow();
      const field = ((input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>)
        .email as Record<string, unknown>;
      field.type = type;
      field.validation = validation;

      expectInvalid(input, 'INVALID_VALUE');
    },
  );

  it.each([
    ['number within bounds', 'number', { minimum: 1, exclusiveMaximum: 20, oneOf: [5, 10] }],
    [
      'text within constraints',
      'text',
      { minLength: 1, maxLength: 4, pattern: '^a', oneOf: ['ab'] },
    ],
  ])('accepts a selection every constraint admits: %s', (_label, type, validation) => {
    const input = workflow();
    const field = ((input.steps as Record<string, unknown>[])[0].data as Record<string, unknown>)
      .email as Record<string, unknown>;
    field.type = type;
    field.validation = validation;

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.data.email).toMatchObject({ type, validation });
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

  it('normalizes legacy string recursively and keeps root structured persist false', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0];
    const data = firstStep.data as Record<string, unknown>;

    data.profile = {
      type: 'object',
      required: true,
      persist: false,
      fields: {
        profileId: {
          type: 'string',
          required: true,
          validation: { format: 'uuid' },
        },
        links: {
          type: 'array',
          required: true,
          items: {
            type: 'string',
            validation: { format: 'uri' },
          },
        },
      },
    };

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.data.profile).toEqual({
      type: 'object',
      required: true,
      persist: false,
      fields: {
        profileId: {
          type: 'text',
          required: true,
          validation: { format: 'uuid' },
        },
        links: {
          type: 'array',
          required: true,
          items: {
            type: 'text',
            validation: { format: 'uri' },
          },
        },
      },
    });
  });

  it('normalizes nested legacy string aliases for arrays of objects at 2+ levels', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0];
    const data = firstStep.data as Record<string, unknown>;

    data.payload = {
      type: 'object',
      required: true,
      fields: {
        contacts: {
          type: 'array',
          required: true,
          validation: { minItems: 1 },
          items: {
            type: 'object',
            fields: {
              profileId: {
                type: 'string',
                required: true,
                validation: { format: 'uuid' },
              },
              phone: {
                type: 'string',
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
                      type: 'string',
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
    };

    const normalized = validateAndNormalizeWorkflow(input);

    expect(normalized.stepsByName.collect_email.data.payload).toEqual({
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
    });
  });

  it('rejects nested persist, nested file, and array-item required declarations', () => {
    const nestedPersist = workflow();
    (
      (nestedPersist.steps as Record<string, unknown>[])[0].data as Record<string, unknown>
    ).profile = {
      type: 'object',
      required: true,
      fields: {
        nested: {
          type: 'text',
          required: true,
          persist: false,
        },
      },
    };
    expectInvalid(nestedPersist);

    const nestedFile = workflow();
    ((nestedFile.steps as Record<string, unknown>[])[0].data as Record<string, unknown>).profile = {
      type: 'object',
      required: true,
      fields: {
        nestedFile: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png'],
            maxSizeBytes: 1024,
          },
        },
      },
    };
    expectInvalid(nestedFile);

    const itemWithRequired = workflow();
    (
      (itemWithRequired.steps as Record<string, unknown>[])[0].data as Record<string, unknown>
    ).phones = {
      type: 'array',
      required: true,
      items: {
        type: 'text',
        required: true,
      },
    };
    expectInvalid(itemWithRequired);
  });

  it('accepts phone and uri formats and rejects empty object/invalid array descriptors', () => {
    const valid = workflow();
    ((valid.steps as Record<string, unknown>[])[0].data as Record<string, unknown>).contact = {
      type: 'object',
      required: true,
      fields: {
        phone: {
          type: 'text',
          required: true,
          validation: { format: 'phone' },
        },
      },
    };
    ((valid.steps as Record<string, unknown>[])[0].data as Record<string, unknown>).urls = {
      type: 'array',
      required: true,
      validation: { minItems: 1 },
      items: {
        type: 'text',
        validation: { format: 'uri' },
      },
    };
    expect(() => validateAndNormalizeWorkflow(valid)).not.toThrow();

    const emptyObject = workflow();
    ((emptyObject.steps as Record<string, unknown>[])[0].data as Record<string, unknown>).meta = {
      type: 'object',
      required: true,
      fields: {},
    };
    expectInvalid(emptyObject);

    const invalidArray = workflow();
    ((invalidArray.steps as Record<string, unknown>[])[0].data as Record<string, unknown>).meta = {
      type: 'array',
      required: true,
      validation: { minItems: 2, maxItems: 1 },
      items: {
        type: 'number',
      },
    };
    expectInvalid(invalidArray);
  });

  it('accepts valid field and transition conditions that reference prior or current-step fields', () => {
    const input = workflow();
    const firstStepData = (input.steps as Record<string, unknown>[])[0].data as Record<
      string,
      unknown
    >;
    firstStepData.residencyCountry = {
      type: 'text',
      required: true,
      validation: { minLength: 1 },
    };

    const secondStepData = (input.steps as Record<string, unknown>[])[1].data as Record<
      string,
      unknown
    >;
    secondStepData.taxIdentifier = {
      type: 'text',
      required: true,
      when: { field: 'residencyCountry', equals: 'US' },
    };
    secondStepData.nickname = {
      type: 'text',
      required: false,
      when: { field: 'taxIdentifier', isSet: true },
    };

    expect(() => validateAndNormalizeWorkflow(input)).not.toThrow();
  });

  it.each([
    ['field when equals', { field: 'residencyCountries', equals: 'US' }],
    ['field when in', { field: 'residencyCountries', in: ['US'] }],
    ['transition when equals', { field: 'residencyCountries', equals: 'US' }],
    ['transition when in', { field: 'residencyCountries', in: ['US'] }],
  ])('rejects %s for manyOf-backed fields', (_label, condition) => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0] as Record<string, unknown>;
    const firstStepData = firstStep.data as Record<string, unknown>;

    firstStepData.residencyCountries = {
      type: 'text',
      required: true,
      validation: { manyOf: ['US', 'CA'] },
    };

    if (_label.startsWith('field')) {
      firstStepData.taxIdentifier = {
        type: 'text',
        required: true,
        when: condition,
      };
    } else {
      firstStep.transitions = [
        {
          status: 'success',
          when: condition,
          target: 'accept_terms',
        },
        {
          status: 'success',
          target: 'accept_terms',
        },
      ];
    }

    expectInvalid(input, 'INVALID_VALUE');
  });

  it.each([
    [
      'invalid condition shape/operators',
      { field: 'residencyCountry', equals: 'US', in: ['CA'] },
      'INVALID_SHAPE',
    ],
    ['empty condition branches', { all: [] }, 'INVALID_SHAPE'],
    ['unknown condition references', { field: 'missingField', equals: 'US' }, 'INVALID_VALUE'],
    ['invalid condition literals', { field: 'residencyCountry', equals: 1 }, 'INVALID_VALUE'],
    ['self-reference', { field: 'residencyCountry', equals: 'US' }, 'INVALID_VALUE'],
    ['dependency cycles', { field: 'countryCode', equals: 'US' }, 'INVALID_VALUE'],
  ])('rejects %s', (_label, condition, reason) => {
    const input = workflow();
    const firstStepData = (input.steps as Record<string, unknown>[])[0].data as Record<
      string,
      unknown
    >;
    firstStepData.residencyCountry = {
      type: 'text',
      required: true,
      validation: { minLength: 1 },
      when: condition,
    };

    if (_label === 'self-reference') {
      (firstStepData.residencyCountry as Record<string, unknown>).when = {
        field: 'residencyCountry',
        equals: 'US',
      };
    }

    if (_label === 'dependency cycles') {
      firstStepData.countryCode = {
        type: 'text',
        required: true,
        validation: { minLength: 1 },
        when: { field: 'countryName', equals: 'US' },
      };
      firstStepData.countryName = {
        type: 'text',
        required: true,
        validation: { minLength: 1 },
        when: { field: 'countryCode', equals: 'US' },
      };
    }

    expectInvalid(input, reason);
  });

  it('rejects automatic conditional transition groups when the unconditional fallback is not final', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0];
    firstStep.transitions = [
      { status: 'success', target: 'accept_terms' },
      {
        status: 'success',
        when: { field: 'email', equals: 'person@example.com' },
        target: 'approved',
      },
    ];

    expectInvalid(input, 'INVALID_TRANSITIONS');
  });

  it('accepts manual transition groups without an unconditional fallback', () => {
    const input = workflow();
    const firstStep = (input.steps as Record<string, unknown>[])[0];
    firstStep.status = 'awaiting_manual_review';
    firstStep.transitions = [
      {
        status: 'manual.approve',
        when: { field: 'email', equals: 'person@example.com' },
        target: 'approved',
      },
      {
        status: 'manual.reject',
        when: { field: 'email', equals: 'person@example.net' },
        target: 'rejected',
      },
    ];

    expect(() => validateAndNormalizeWorkflow(input)).not.toThrow();
  });

  it('preserves compatibility for unconditional transition groups', () => {
    const normalized = validateAndNormalizeWorkflow(workflow());

    expect(normalized.stepsByName.collect_email.transitions).toEqual([
      { status: 'success', target: 'accept_terms' },
    ]);
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
