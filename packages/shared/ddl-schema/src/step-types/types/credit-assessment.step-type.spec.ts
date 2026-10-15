import type { RawWorkflowStep } from '../../workflow-contract';
import { compileWorkflow } from '../workflow.compiler';

const terminal = (name: string, outcome = 'approved'): RawWorkflowStep => ({
  name,
  type: 'terminal',
  config: { outcome },
});

const EDGES = { approved: 'done', review: 'manual', declined: 'refused', retry: 'ask' };

const creditStep = (config: Record<string, unknown> = {}): RawWorkflowStep => ({
  name: 'assess',
  type: 'credit-assessment',
  config: { connector: { id: 'mock_credit' }, ...config },
  edges: EDGES,
});

const compile = (config: Record<string, unknown> = {}, collect = true) =>
  compileWorkflow({
    id: 'credit',
    version: 1,
    steps: [
      ...(collect
        ? [
            {
              name: 'ask',
              type: 'identity-profile',
              config: { nationalities: ['GB'] },
              include: [{ type: 'contact-details' }],
              edges: { success: 'assess' },
            } as RawWorkflowStep,
          ]
        : []),
      creditStep(config),
      terminal('done'),
      terminal('refused', 'rejected'),
      terminal('manual', 'invalid'),
    ],
  });

const assessStep = (config: Record<string, unknown> = {}, collect = true) =>
  compile(config, collect).steps.find((step) => step.name === 'assess')!;

describe('credit-assessment', () => {
  it('compiles to one parked step with an async connector at order 1', () => {
    const step = assessStep();

    expect(step.status).toBe('awaiting_user');
    expect(step.connectors).toHaveLength(1);
    expect(step.connectors![0]).toMatchObject({
      id: 'mock_credit',
      type: 'credit',
      async: true,
      order: 1,
      fieldMapping: { bankData: 'bankData' },
    });
  });

  it('passes the defaults to the connector config', () => {
    expect(assessStep().connectors![0].config).toEqual({
      bands: { approveFrom: 700, reviewFrom: 400 },
      maxAttempts: 3,
      products: ['creditScore', 'paymentScore'],
      report: 'full',
    });
  });

  it('passes authored bands, attempts, products and report mode through', () => {
    const step = assessStep({
      bands: { approveFrom: 800, reviewFrom: 500 },
      maxAttempts: 5,
      products: ['creditScore'],
      report: 'summary',
    });

    expect(step.connectors![0].config).toEqual({
      bands: { approveFrom: 800, reviewFrom: 500 },
      maxAttempts: 5,
      products: ['creditScore'],
      report: 'summary',
    });
  });

  it.each([
    ['equal bands', { approveFrom: 500, reviewFrom: 500 }],
    ['inverted bands', { approveFrom: 300, reviewFrom: 400 }],
    ['a default-colliding approveFrom', { approveFrom: 400 }],
    ['a band above 1000', { approveFrom: 1001 }],
    ['a negative band', { reviewFrom: -1 }],
    ['a fractional band', { approveFrom: 700.5 }],
  ])('refuses %s', (_label, bands) => {
    expect(() => compile({ bands })).toThrow('WORKFLOW_INVALID');
  });

  it.each([
    ['maxAttempts 0', { maxAttempts: 0 }],
    ['an unknown report mode', { report: 'verbose' }],
    ['empty products', { products: [] }],
    ['a non-positive upload cap', { bankDataMaxSizeBytes: 0 }],
    ['an unknown applicant role', { applicant: { dateOfBirth: true } }],
  ])('refuses %s', (_label, config) => {
    expect(() => compile(config)).toThrow('WORKFLOW_INVALID');
  });

  it('refuses a connector config the slot does not allow', () => {
    expect(() => compile({ connector: { id: 'mock_credit', config: { extra: 1 } } })).toThrow(
      'WORKFLOW_INVALID',
    );
  });

  it('exposes the four ports', () => {
    expect(() =>
      compileWorkflow({
        id: 'credit',
        version: 1,
        steps: [
          { ...creditStep(), edges: { approved: 'done', review: 'done', declined: 'done' } },
          terminal('done'),
        ],
      }),
    ).toThrow('WORKFLOW_INVALID');
  });

  it('owns a required JSON bankData upload, capped at 1 MiB by default', () => {
    expect(assessStep().data.bankData).toMatchObject({
      type: 'file',
      required: true,
      validation: { contentTypes: ['application/json'], maxSizeBytes: 1048576 },
    });
    expect(assessStep({ bankDataMaxSizeBytes: 2048 }).data.bankData).toMatchObject({
      validation: { contentTypes: ['application/json'], maxSizeBytes: 2048 },
    });
  });

  it('declares every callback field as optional, and shows only six of them to the client', () => {
    const { data } = assessStep();
    const callbackFields = [
      'creditOutcome',
      'creditScore',
      'creditScoreBand',
      'creditIndicators',
      'creditSecondaryScores',
      'creditReasonCodes',
      'creditAttemptCount',
      'creditProviderReference',
      'creditReport',
    ];

    for (const name of callbackFields) {
      expect(data[name]).toMatchObject({ required: false });
    }

    const visible = Object.keys(data).filter((name) => data[name].clientVisible === true);

    expect(visible.sort()).toEqual(
      [
        'creditAttemptCount',
        'creditIndicators',
        'creditOutcome',
        'creditReport',
        'creditScore',
        'creditScoreBand',
        'creditSecondaryScores',
      ].sort(),
    );
    expect(data.creditReport.type).toBe('json');
    expect(data.creditScoreBand).toMatchObject({
      validation: { oneOf: ['approve', 'review', 'decline'] },
    });
    expect(data.creditOutcome).toMatchObject({
      validation: { oneOf: ['approved', 'review', 'declined', 'retry'] },
    });
  });

  it('routes each outcome on its own arm with review last and unconditional', () => {
    const { transitions } = assessStep();

    expect(transitions.map((transition) => transition.target)).toEqual([
      'done',
      'refused',
      'ask',
      'manual',
    ]);
    expect(transitions[0].when).toEqual({ field: 'creditOutcome', equals: 'approved' });
    expect(transitions[1].when).toEqual({ field: 'creditOutcome', equals: 'declined' });
    expect(transitions[2].when).toEqual({ field: 'creditOutcome', equals: 'retry' });
    expect(transitions[3]).toEqual({ status: 'success', target: 'manual' });
  });

  it('maps the applicant roles an author opts into from earlier steps', () => {
    const step = assessStep({ applicant: { firstName: true, email: true, lastName: false } });
    const mapping = step.connectors![0].fieldMapping;

    expect(Object.keys(mapping).sort()).toEqual(['bankData', 'email', 'firstName']);
  });

  it('fails with a named error when an opted-in role is collected by no step', () => {
    expect(() => compile({ applicant: { firstName: true } }, false)).toThrow('WORKFLOW_INVALID');
  });
});
