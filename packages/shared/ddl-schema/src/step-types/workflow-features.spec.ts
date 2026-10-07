import { compileWorkflow, compileWorkflowReport } from './workflow.compiler';
import type { RawWorkflowStep, RawWorkflowDefinition } from '../workflow-contract';
import { WorkflowInvalidError, type WorkflowInvalidReason } from '../workflow-invalid.error';
import { validateAndNormalizeWorkflow } from '../workflow-validator';

const terminal = (name: string, outcome = 'approved'): RawWorkflowStep => ({
  name,
  type: 'terminal',
  config: { outcome },
});

const graph = (
  steps: readonly RawWorkflowStep[],
  root: Partial<RawWorkflowDefinition> = {},
): RawWorkflowDefinition => ({
  id: 'graph',
  version: 1,
  steps: [...steps],
  ...root,
});

const form = (
  name: string,
  fields: Record<string, unknown>,
  rest: Partial<RawWorkflowStep> = {},
): RawWorkflowStep => ({ name, type: 'form', config: { fields }, ...rest });

const expectInvalid = (document: unknown, reason: WorkflowInvalidReason, path?: string): void => {
  try {
    compileWorkflow(document);
    throw new Error('Expected compilation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowInvalidError);
    expect(error).toMatchObject({ reason });

    if (path !== undefined) {
      expect((error as WorkflowInvalidError).path).toBe(path);
    }
  }
};

describe('conditional edges', () => {
  it('fan one port out into an arm per condition, with the fallback last', () => {
    const compiled = compileWorkflow(
      graph([
        form(
          'where',
          { country: { type: 'text', required: true } },
          {
            edges: {
              success: [
                { when: { field: 'country', equals: 'FR' }, target: 'france' },
                { target: 'elsewhere' },
              ],
            },
          },
        ),
        terminal('france'),
        terminal('elsewhere', 'rejected'),
      ]),
    );

    expect(compiled.steps[0].transitions).toEqual([
      { status: 'success', when: { field: 'country', equals: 'FR' }, target: 'france' },
      { status: 'success', target: 'elsewhere' },
    ]);
  });

  it("conjoin an arm's condition with the one the step's own port already carries", () => {
    const compiled = compileWorkflow(
      graph([
        form('who', { vip: { type: 'boolean', required: true } }, { edges: { success: 'pick' } }),
        {
          name: 'pick',
          type: 'document-choice',
          config: { documents: [{ type: 'PASSPORT', countries: ['FR'] }] },
          edges: {
            PASSPORT: [
              { when: { field: 'vip', equals: true }, target: 'fast' },
              { target: 'slow' },
            ],
          },
        },
        {
          name: 'fast',
          type: 'document-capture',
          config: { document: 'PASSPORT' },
          edges: { success: 'done' },
        },
        {
          name: 'slow',
          type: 'document-capture',
          config: { document: 'PASSPORT', sides: 2 },
          edges: { success: 'done' },
        },
        terminal('done'),
      ]),
    );

    expect(compiled.steps[1].transitions).toEqual([
      {
        status: 'success',
        when: {
          all: [
            { field: 'documentType', equals: 'PASSPORT' },
            { field: 'vip', equals: true },
          ],
        },
        target: 'fast',
      },
      {
        status: 'success',
        when: { field: 'documentType', equals: 'PASSPORT' },
        target: 'slow_front',
      },
    ]);
  });

  it('refuse a fallback arm that is not last, and two fallbacks', () => {
    expectInvalid(
      graph([
        form(
          'where',
          { country: { type: 'text', required: true } },
          {
            edges: {
              success: [
                { target: 'done' },
                { when: { field: 'country', equals: 'FR' }, target: 'done' },
              ],
            },
          },
        ),
        terminal('done'),
      ]),
      'INVALID_TRANSITIONS',
      'steps[0].edges.success',
    );
    expectInvalid(
      graph([
        form(
          'where',
          { country: { type: 'text', required: true } },
          { edges: { success: [{ target: 'done' }, { target: 'done' }] } },
        ),
        terminal('done'),
      ]),
      'INVALID_TRANSITIONS',
      'steps[0].edges.success',
    );
  });

  it('produce a document the compiled form accepts', () => {
    const document = graph([
      form(
        'where',
        { country: { type: 'text', required: true } },
        {
          edges: {
            success: [
              { when: { field: 'country', equals: 'FR' }, target: 'france' },
              { target: 'elsewhere' },
            ],
          },
        },
      ),
      terminal('france'),
      terminal('elsewhere', 'rejected'),
    ]);

    expect(validateAndNormalizeWorkflow(document).stepsByName.where.transitions).toHaveLength(2);
  });
});

describe('a step contract scoped to ancestors', () => {
  it('leaves a document captured after the check out of what the check submits', () => {
    const compiled = compileWorkflow(
      graph([
        {
          name: 'who',
          type: 'identity-profile',
          config: { nationalities: ['FR'] },
          include: [
            { type: 'address', config: { countries: ['FR'] } },
            { type: 'questionnaire', config: { sections: ['purpose'] } },
          ],
          edges: { success: 'face' },
        },
        { name: 'face', type: 'selfie-capture', edges: { success: 'check' } },
        {
          name: 'check',
          type: 'kyc-identity-verification',
          config: {
            connector: { id: 'sumsub_kyc' },
            levelName: 'level',
            sourceKey: 'source',
            questionnaireDefinitionId: 'questions',
            maxAttemptsPerDocSet: 3,
          },
          edges: {
            verified: 'later',
            review: 'later',
            'retry.IDENTITY': 'face',
            'retry.SELFIE': 'face',
            'retry.APPLICANT_DATA': 'later',
            'retry.QUESTIONNAIRE': 'who',
            refused: 'refused',
          },
        },
        // Collected only after the verdict: a proof the check never sees.
        {
          name: 'later',
          type: 'document-capture',
          config: { document: 'UTILITY_BILL' },
          edges: { success: 'done' },
        },
        terminal('done'),
        terminal('refused', 'rejected'),
      ]),
    );
    const connector = compiled.steps.find((step) => step.name === 'check')!.connectors![0];

    expect(
      (connector.config!.documents as { payloadField: string }[]).map((d) => d.payloadField),
    ).toEqual(['selfieDocumentId']);
    expect(connector.optionalFieldMapping).toEqual({});
  });
});

describe('meta', () => {
  it('is carried on the root and on a step, and never reaches the compiled document', () => {
    const compiled = compileWorkflow(
      graph(
        [
          form(
            'ask',
            { a: { type: 'text', required: true } },
            { edges: { success: 'done' }, meta: { title: 'Ask', position: { x: 10, y: 20 } } },
          ),
          terminal('done'),
        ],
        { meta: { canvas: { zoom: 1 } } },
      ),
    );

    expect(JSON.stringify(compiled)).not.toContain('meta');
  });
});

describe('the compile report', () => {
  it('describes every step: its compiled steps and where each port leads, in authored names', () => {
    const report = compileWorkflowReport(
      graph([
        {
          name: 'card',
          type: 'document-capture',
          config: { document: 'ID_CARD', sides: 2 },
          edges: { success: 'done' },
        },
        terminal('done'),
      ]),
    );

    expect(report.steps).toEqual([
      {
        name: 'card',
        type: 'document-capture',
        category: 'collect',
        compiledStepNames: ['card_front', 'card_back'],
        ports: [{ name: 'success', arms: [{ target: 'done' }] }],
      },
      {
        name: 'done',
        type: 'terminal',
        category: 'terminal',
        compiledStepNames: ['done'],
        ports: [],
      },
    ]);
    expect(report.definition.steps.map((step) => step.name)).toEqual([
      'card_front',
      'card_back',
      'done',
    ]);
  });
});

describe('an edge that opts out of the client notification', () => {
  const graphWith = (edge: unknown) =>
    graph([
      form(
        'ask',
        { email: { type: 'text', required: true } },
        { edges: { success: edge as never } },
      ),
      form('agree', { ok: { type: 'boolean', required: true } }, { edges: { success: 'done' } }),
      terminal('done'),
    ]);

  it('carries `webhook: { notify: false }` from the arm onto the transition it becomes, and nowhere else', () => {
    const compiled = compileWorkflow(graphWith([{ target: 'agree', webhook: { notify: false } }]));

    expect(compiled.steps[0].transitions).toEqual([
      { status: 'success', target: 'agree', webhook: { notify: false } },
    ]);
    expect(compiled.steps[1].transitions).toEqual([{ status: 'success', target: 'done' }]);
  });

  it('normalizes to the same opt-out a hand-written transition declares', () => {
    const normalized = validateAndNormalizeWorkflow({
      ...graphWith([{ target: 'agree', webhook: { notify: false } }]),
      webhook: { notify: { path: 'notify' } },
    });

    expect(normalized.stepsByName.ask.transitions[0].webhook).toEqual({ notify: false });
    expect(normalized.stepsByName.agree.transitions[0].webhook).toBeUndefined();
  });

  it('refuses an arm that tries to name a destination of its own', () => {
    // An edge is a step name or a list of arms, so Ajv reports the refusal at the edge itself.
    try {
      compileWorkflow(graphWith([{ target: 'agree', webhook: { notify: { path: 'elsewhere' } } }]));
      throw new Error('Expected compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowInvalidError);
      expect((error as WorkflowInvalidError).path).toMatch(/^steps\[0\]\.edges\.success/);
    }
  });
});

describe('step-level scoring', () => {
  const scored = (steps: readonly RawWorkflowStep[]) =>
    graph(steps, { scoring: { risk: { min: 0, max: 100 } } });

  it('attaches the rules to the entry step of a step whose type says nothing else', () => {
    const rules = [{ score: 'risk', when: { field: 'country', in: ['RU'] }, add: 40 }];
    const compiled = compileWorkflow(
      scored([
        form(
          'where',
          { country: { type: 'text', required: true } },
          { scoring: rules, edges: { success: 'done' } },
        ),
        terminal('done'),
      ]),
    );

    expect(compiled.steps[0].scoring).toEqual(rules);
    expect(compiled.steps[1].scoring).toBeUndefined();
  });

  it('attaches them to the check of an OTP challenge, where the outcome is known', () => {
    const rules = [{ score: 'risk', add: -10 }];
    const compiled = compileWorkflow(
      scored([
        {
          name: 'contact',
          type: 'contact-details',
          config: { email: 'omitted' },
          edges: { success: 'phone' },
        },
        {
          name: 'phone',
          type: 'otp-verify',
          config: { channel: 'sms', connector: { id: 'otp' } },
          scoring: rules,
          edges: { verified: 'done', refused: 'refused' },
        },
        terminal('done'),
        terminal('refused', 'rejected'),
      ]),
    );
    const byName = Object.fromEntries(compiled.steps.map((step) => [step.name, step]));

    expect(byName.phone.scoring).toBeUndefined();
    expect(byName.phone_verify.scoring).toEqual(rules);
    expect(byName.phone_resend.scoring).toBeUndefined();
  });

  it('routes on the result through a conditional edge, with no decision step in between', () => {
    const normalized = validateAndNormalizeWorkflow(
      scored([
        form(
          'where',
          { country: { type: 'text', required: true } },
          {
            scoring: [{ score: 'risk', when: { field: 'country', in: ['RU'] }, add: 60 }],
            edges: {
              success: [
                { when: { score: 'risk', gte: 60 }, target: 'refused' },
                { target: 'done' },
              ],
            },
          },
        ),
        terminal('done'),
        terminal('refused', 'rejected'),
      ]),
    );

    expect(normalized.stepsByName.where.scoring).toHaveLength(1);
    expect(normalized.stepsByName.where.transitions.map((transition) => transition.target)).toEqual(
      ['refused', 'done'],
    );
  });

  it('refuses rules on a terminal, which is never submitted, and on a risk-score, which has its own', () => {
    expectInvalid(
      scored([
        form('ask', { a: { type: 'text', required: true } }, { edges: { success: 'done' } }),
        { ...terminal('done'), scoring: [{ score: 'risk', add: 1 }] },
      ]),
      'INVALID_VALUE',
      'steps[1].scoring',
    );
    expectInvalid(
      scored([
        form('ask', { a: { type: 'text', required: true } }, { edges: { success: 'assess' } }),
        {
          name: 'assess',
          type: 'risk-score',
          config: {
            rules: [{ score: 'risk', add: 10 }],
            bands: [{ port: 'high', score: 'risk', gte: 10 }],
          },
          scoring: [{ score: 'risk', add: 1 }],
          edges: { high: 'done' },
        },
        terminal('done'),
      ]),
      'INVALID_VALUE',
      'steps[1].scoring',
    );
  });

  it('is held to the compiled form’s own rules once compiled', () => {
    // No root score named `risk`: the same refusal a hand-written step's rule gets.
    expect(() =>
      validateAndNormalizeWorkflow(
        graph([
          form(
            'ask',
            { a: { type: 'text', required: true } },
            { scoring: [{ score: 'risk', add: 1 }], edges: { success: 'done' } },
          ),
          terminal('done'),
        ]),
      ),
    ).toThrow(expect.objectContaining({ reason: 'INVALID_VALUE' }));
  });
});
