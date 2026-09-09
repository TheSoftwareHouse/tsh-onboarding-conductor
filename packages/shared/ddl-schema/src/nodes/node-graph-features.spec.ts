import { compileNodeGraph, compileNodeGraphReport } from './node-graph.compiler';
import type { RawWorkflowNode, RawWorkflowNodeGraphDefinition } from './node-graph.contract';
import { WorkflowInvalidError, type WorkflowInvalidReason } from '../workflow-invalid.error';
import { validateAndNormalizeWorkflow } from '../workflow-validator';

const terminal = (name: string, outcome = 'approved'): RawWorkflowNode => ({
  name,
  type: 'terminal',
  config: { outcome },
});

const graph = (
  nodes: readonly RawWorkflowNode[],
  root: Partial<RawWorkflowNodeGraphDefinition> = {},
): RawWorkflowNodeGraphDefinition => ({
  id: 'graph',
  version: 1,
  name: 'Graph',
  nodes: [...nodes],
  ...root,
});

const form = (
  name: string,
  fields: Record<string, unknown>,
  rest: Partial<RawWorkflowNode> = {},
): RawWorkflowNode => ({ name, type: 'form', config: { fields }, ...rest });

const expectInvalid = (document: unknown, reason: WorkflowInvalidReason, path?: string): void => {
  try {
    compileNodeGraph(document);
    throw new Error('Expected node graph compilation to fail');
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
    const compiled = compileNodeGraph(
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

  it("conjoin an arm's condition with the one the node's own port already carries", () => {
    const compiled = compileNodeGraph(
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
      'nodes[0].edges.success',
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
      'nodes[0].edges.success',
    );
  });

  it('produce a document the step form accepts', () => {
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

describe('a node contract scoped to ancestors', () => {
  it('leaves a document captured after the check out of what the check submits', () => {
    const compiled = compileNodeGraph(
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
  it('is carried on the root and on a node, and never reaches the compiled document', () => {
    const compiled = compileNodeGraph(
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
  it('describes every node: its steps and where each port leads, in authored names', () => {
    const report = compileNodeGraphReport(
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

    expect(report.nodes).toEqual([
      {
        name: 'card',
        type: 'document-capture',
        category: 'collect',
        stepNames: ['card_front', 'card_back'],
        ports: [{ name: 'success', arms: [{ target: 'done' }] }],
      },
      { name: 'done', type: 'terminal', category: 'terminal', stepNames: ['done'], ports: [] },
    ]);
    expect(report.definition.steps.map((step) => step.name)).toEqual([
      'card_front',
      'card_back',
      'done',
    ]);
  });
});
