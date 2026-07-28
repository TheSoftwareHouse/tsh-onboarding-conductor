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
            cardNumber: {
              type: 'text',
              required: true,
              validation: { format: 'credit-card' },
            },
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

  it('distinguishes absent transitions from declared targetless non-manual transitions by trigger', () => {
    const step = createStep();

    expect(step.transitionTargetName('manual.approve')).toBeUndefined();
    expect(step.transitionTargetName('manual.invalid')).toBeUndefined();

    const recursiveStepDefinition = validateAndNormalizeWorkflow({
      id: 'custom',
      version: 1,
      name: 'Custom',
      initial: 'review',
      steps: [
        {
          name: 'review',
          status: 'awaiting_user',
          data: {},
          transitions: [{ status: 'success' }],
        },
        {
          name: 'approved',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    }).stepsByName.review;

    const recursiveStep = new Step(recursiveStepDefinition);

    expect(recursiveStep.transitionTargetName('success')).toBeNull();
    expect(recursiveStep.transitionTargetName('manual.approve')).toBeUndefined();
  });

  it('validates and projects accepted data while preserving IBAN value', () => {
    const step = createStep();
    const invalidDataWithExtra = {
      cardNumber: '4111-1111-1111-1111',
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
      cardNumber: '4111-1111-1111-1111',
      iban: '  de89 3704 0044 0532 0130 00 ',
      retries: 0,
      approved: false,
      note: '',
    };
    const result = step.collectAcceptedData(submittedData);

    expect(result).toEqual({
      acceptedData: {
        cardNumber: '************1111',
        iban: '  de89 3704 0044 0532 0130 00 ',
        retries: 0,
        approved: false,
      },
      connectorData: {
        cardNumber: '************1111',
        iban: '  de89 3704 0044 0532 0130 00 ',
        retries: 0,
        approved: false,
        note: '',
      },
      fieldErrors: {},
    });
    expect(submittedData).toEqual({
      cardNumber: '4111-1111-1111-1111',
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
                cards: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'text',
                    validation: { format: 'credit-card' },
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
        cards: ['4111-1111-1111-1111'],
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
          cards: ['************1111'],
        },
      },
      fieldErrors: {},
    });
  });

  it('returns null accepted and connector data for invalid nested structured values', () => {
    const definition = validateAndNormalizeWorkflow({
      id: 'invalid-nested',
      version: 1,
      name: 'Invalid Nested',
      initial: 'collect_profile',
      steps: [
        {
          name: 'collect_profile',
          status: 'awaiting_user',
          data: {
            profile: {
              type: 'object',
              required: true,
              fields: {
                contacts: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    fields: {
                      profileId: {
                        type: 'text',
                        required: true,
                        validation: { format: 'uuid' },
                      },
                    },
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

    expect(
      step.collectAcceptedData({
        profile: {
          contacts: [{ profileId: 'not-a-uuid' }],
        },
      }),
    ).toEqual({
      acceptedData: null,
      connectorData: null,
      fieldErrors: {
        profile: ['INVALID'],
      },
    });
  });

  it('projects root array fields and keeps default/explicit persist true values in accepted data', () => {
    const definition = validateAndNormalizeWorkflow({
      id: 'structured-persist-true',
      version: 1,
      name: 'Structured Persist True',
      initial: 'collect_profile',
      steps: [
        {
          name: 'collect_profile',
          status: 'awaiting_user',
          data: {
            cards: {
              type: 'array',
              required: true,
              items: {
                type: 'text',
                validation: { format: 'credit-card' },
              },
            },
            profile: {
              type: 'object',
              required: true,
              persist: true,
              fields: {
                links: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'text',
                    validation: { format: 'uri' },
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
      cards: ['4111-1111-1111-1111'],
      profile: {
        links: ['https://tsh.io/docs'],
      },
    };

    expect(step.collectAcceptedData(submittedData)).toEqual({
      acceptedData: {
        cards: ['************1111'],
        profile: {
          links: ['https://tsh.io/docs'],
        },
      },
      connectorData: {
        cards: ['************1111'],
        profile: {
          links: ['https://tsh.io/docs'],
        },
      },
      fieldErrors: {},
    });
  });

  it.each([
    [
      'missing required field',
      { cardNumber: '4111111111111111', retries: 1, approved: true, note: '' },
    ],
    [
      'credit card format mismatch',
      {
        cardNumber: 'not-a-card',
        iban: 'DE89 3704 0044 0532 0130 00',
        retries: 1,
        approved: true,
        note: '',
      },
    ],
    [
      'undefined value',
      {
        cardNumber: undefined,
        iban: 'DE89 3704 0044 0532 0130 00',
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
});
