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
  });
});
