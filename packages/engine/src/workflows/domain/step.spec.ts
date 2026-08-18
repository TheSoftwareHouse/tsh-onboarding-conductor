import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import { Step } from './step';

describe('Step', () => {
  const createStep = () => {
    const definition = validateAndNormalizeWorkflow({
      id: 'custom',
      version: 1,
      name: 'Custom',
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            iban: {
              type: 'text',
              required: true,
              validation: { format: 'account-number' },
            },
            retries: {
              type: 'number',
              required: true,
              validation: { minimum: 0 },
            },
            approved: {
              type: 'boolean',
              required: true,
            },
            note: {
              type: 'text',
              required: true,
              persist: false,
              validation: { minLength: 0 },
            },
            optionalTag: {
              type: 'text',
              required: false,
              validation: { oneOf: ['vip', 'urgent'] },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    return new Step(definition.stepsByName.collect_data);
  };

  it('exposes terminal and status metadata with success transition target name', () => {
    const step = createStep();

    expect(step.name).toBe('collect_data');
    expect(step.status).toBe('awaiting_user');
    expect(step.isTerminal).toBe(false);
    expect(step.transitionTargetName('success')).toBe('finished');
  });

  it('validates and preserves active submitted values without projection', () => {
    const step = createStep();
    const invalidDataWithExtra = {
      iban: '  de89 3704 0044 0532 0130 00 ',
      retries: 0,
      approved: false,
      note: '',
      extra: 'ignored',
    };

    expect(step.collectAcceptedData(invalidDataWithExtra)).toEqual({
      acceptedData: null,
      connectorData: null,
      fieldErrors: { extra: ['UNKNOWN'] },
    });

    const submittedData = {
      iban: '  de89 3704 0044 0532 0130 00 ',
      retries: 0,
      approved: false,
      note: '',
    };

    expect(step.collectAcceptedData(submittedData)).toEqual({
      acceptedData: {
        iban: '  de89 3704 0044 0532 0130 00 ',
        retries: 0,
        approved: false,
      },
      connectorData: {
        iban: '  de89 3704 0044 0532 0130 00 ',
        retries: 0,
        approved: false,
        note: '',
      },
      fieldErrors: {},
    });
    expect(submittedData).toEqual({
      iban: '  de89 3704 0044 0532 0130 00 ',
      retries: 0,
      approved: false,
      note: '',
    });
  });

  it('excludes root structured persist:false from accepted data while keeping connector payload', () => {
    const definition = validateAndNormalizeWorkflow({
      id: 'structured',
      version: 1,
      name: 'Structured',
      initial: 'collect_profile',
      steps: [
        {
          name: 'collect_profile',
          status: 'awaiting_user',
          data: {
            summary: {
              type: 'text',
              required: true,
            },
            profile: {
              type: 'object',
              required: true,
              persist: false,
              fields: {
                phones: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'text',
                    validation: { format: 'phone' },
                  },
                },
                aliases: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'text',
                  },
                },
              },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const step = new Step(definition.stepsByName.collect_profile);
    const submittedData = {
      summary: 'ok',
      profile: {
        phones: ['+14155552671'],
        aliases: ['prime'],
      },
    };

    expect(step.collectAcceptedData(submittedData)).toEqual({
      acceptedData: {
        summary: 'ok',
      },
      connectorData: {
        summary: 'ok',
        profile: {
          phones: ['+14155552671'],
          aliases: ['prime'],
        },
      },
      fieldErrors: {},
    });
  });

  it('uses persisted context and valid same-step dependencies to activate fields', () => {
    const definition = validateAndNormalizeWorkflow({
      id: 'conditional-dependencies',
      version: 1,
      name: 'Conditional Dependencies',
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
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
            region: {
              type: 'text',
              required: true,
              when: { field: 'taxId', equals: 'ABC' },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const step = new Step(definition.stepsByName.collect_data);

    expect(
      step.collectAcceptedData({ country: 'US', taxId: 'ABC', region: 'west' }, { country: 'US' }),
    ).toEqual({
      acceptedData: {
        country: 'US',
        taxId: 'ABC',
        region: 'west',
      },
      connectorData: {
        country: 'US',
        taxId: 'ABC',
        region: 'west',
      },
      fieldErrors: {},
    });
  });

  it('treats selector false and true differently for the same field', () => {
    const definition = validateAndNormalizeWorkflow({
      id: 'conditional-toggle',
      version: 1,
      name: 'Conditional Toggle',
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            country: {
              type: 'text',
              required: true,
            },
            accountNumber: {
              type: 'text',
              required: true,
              validation: { format: 'account-number' },
              when: { field: 'country', equals: 'US' },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const step = new Step(definition.stepsByName.collect_data);
    const falseResult = step.collectAcceptedData(
      { country: 'CA', accountNumber: 'DE89 3704 0044 0532 0130 00' },
      {},
    );

    expect(falseResult).toEqual({
      acceptedData: null,
      connectorData: null,
      fieldErrors: {
        accountNumber: ['UNKNOWN'],
      },
    });

    const trueResult = step.collectAcceptedData(
      { country: 'US', accountNumber: 'DE89 3704 0044 0532 0130 00' },
      {},
    );

    expect(trueResult).toEqual({
      acceptedData: {
        country: 'US',
        accountNumber: 'DE89 3704 0044 0532 0130 00',
      },
      connectorData: {
        country: 'US',
        accountNumber: 'DE89 3704 0044 0532 0130 00',
      },
      fieldErrors: {},
    });
  });

  it('does not activate fields with missing or invalid selectors', () => {
    const definition = validateAndNormalizeWorkflow({
      id: 'conditional-selector',
      version: 1,
      name: 'Conditional Selector',
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            country: {
              type: 'text',
              required: true,
              validation: { minLength: 1 },
            },
            taxId: {
              type: 'text',
              required: true,
              when: { field: 'country', equals: 'US' },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const step = new Step(definition.stepsByName.collect_data);

    expect(step.collectAcceptedData({ taxId: 'ABC' }, {})).toEqual({
      acceptedData: null,
      connectorData: null,
      fieldErrors: {
        country: ['REQUIRED'],
        taxId: ['UNKNOWN'],
      },
    });

    expect(step.collectAcceptedData({ country: '', taxId: 'ABC' }, {})).toEqual({
      acceptedData: null,
      connectorData: null,
      fieldErrors: {
        country: ['INVALID'],
        taxId: ['UNKNOWN'],
      },
    });
  });

  it('keeps unconditional workflows compatible', () => {
    const step = createStep();

    expect(
      step.collectAcceptedData({
        iban: 'DE89 3704 0044 0532 0130 00',
        retries: 0,
        approved: false,
        note: '',
      }),
    ).toMatchObject({
      acceptedData: {
        iban: 'DE89 3704 0044 0532 0130 00',
        retries: 0,
        approved: false,
      },
      connectorData: {
        iban: 'DE89 3704 0044 0532 0130 00',
        retries: 0,
        approved: false,
        note: '',
      },
      fieldErrors: {},
    });
  });

  it.each([
    ['missing required field', { iban: 'DE89 3704 0044 0532 0130 00', retries: 1, note: '' }],
    [
      'account-number format mismatch',
      {
        iban: 'not-an-account-number',
        retries: 1,
        approved: true,
        note: '',
      },
    ],
    [
      'undefined value',
      {
        iban: undefined,
        retries: 1,
        approved: true,
        note: '',
      },
    ],
    ['malformed body', null],
    ['array body', []],
  ])('returns invalid-data payload for %s', (_description, submittedData) => {
    const step = createStep();

    expect(step.collectAcceptedData(submittedData).acceptedData).toBeNull();
    expect(step.collectAcceptedData(submittedData).connectorData).toBeNull();
  });
  const createRenderWorkflowStep = (stepName: 'collect_documents' | 'review') => {
    const definition = validateAndNormalizeWorkflow({
      id: 'render-controls',
      version: 1,
      name: 'Render Controls',
      initial: 'collect_documents',
      steps: [
        {
          name: 'collect_documents',
          status: 'awaiting_user',
          data: {
            country: {
              type: 'text',
              required: true,
              validation: { oneOf: ['US', 'CA'] },
            },
            taxId: {
              type: 'text',
              required: true,
              when: { field: 'country', equals: 'US' },
            },
            identityDocument: {
              type: 'file',
              required: true,
              validation: {
                contentTypes: ['image/png'],
                maxSizeBytes: 1024,
                maxImageWidth: 640,
              },
            },
          },
          transitions: [{ status: 'success', target: 'review' }],
        },
        {
          name: 'review',
          status: 'awaiting_manual_review',
          data: {},
          transitions: [
            { status: 'manual.approve', target: 'approved' },
            { status: 'manual.reject', target: 'rejected' },
          ],
        },
        { name: 'approved', status: 'approved', data: {}, transitions: [] },
        { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
      ],
    });

    return new Step(definition.stepsByName[stepName]);
  };

  it('describes declared controls in declaration order with unresolved conditions left to the client', () => {
    const step = createRenderWorkflowStep('collect_documents');

    expect(step.describe()).toEqual({
      name: 'collect_documents',
      status: 'awaiting_user',
      canSubmit: true,
      fields: [
        {
          name: 'country',
          type: 'text',
          required: true,
          active: true,
          dependsOn: [],
          schema: { type: 'string', enum: ['US', 'CA'] },
          value: null,
        },
        {
          name: 'taxId',
          type: 'text',
          required: true,
          active: false,
          dependsOn: ['country'],
          when: { field: 'country', equals: 'US' },
          schema: { type: 'string' },
          value: null,
        },
        {
          name: 'identityDocument',
          type: 'file',
          required: true,
          active: true,
          dependsOn: [],
          schema: { type: 'string', minLength: 1 },
          value: null,
          upload: {
            contentTypes: ['image/png'],
            maxSizeBytes: 1024,
            maxImageWidth: 640,
          },
        },
      ],
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          country: { type: 'string', enum: ['US', 'CA'] },
          identityDocument: { type: 'string', minLength: 1 },
        },
        required: ['country', 'identityDocument'],
      },
    });
  });

  it('activates conditional controls and prefills values from persisted context', () => {
    const step = createRenderWorkflowStep('collect_documents');

    const description = step.describe({ country: 'US', unrelated: 'ignored' });

    expect(description.fields).toEqual([
      expect.objectContaining({ name: 'country', active: true, value: 'US' }),
      expect.objectContaining({ name: 'taxId', active: true, value: null }),
      expect.objectContaining({ name: 'identityDocument', active: true, value: null }),
    ]);
    expect(description.schema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        country: { type: 'string', enum: ['US', 'CA'] },
        taxId: { type: 'string' },
        identityDocument: { type: 'string', minLength: 1 },
      },
      required: ['country', 'taxId', 'identityDocument'],
    });
  });

  it('reports a manual-review step as not submittable and without controls', () => {
    expect(createRenderWorkflowStep('review').describe()).toEqual({
      name: 'review',
      status: 'awaiting_manual_review',
      canSubmit: false,
      fields: [],
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: [],
      },
    });
  });
});
