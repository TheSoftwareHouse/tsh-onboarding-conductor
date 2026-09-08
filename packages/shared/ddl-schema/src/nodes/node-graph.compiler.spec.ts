import { compileNodeGraph } from './node-graph.compiler';
import { isNodeGraphDefinition } from './node-graph.contract';
import type { RawWorkflowNode, RawWorkflowNodeGraphDefinition } from './node-graph.contract';
import {
  WORKFLOW_INVALID,
  WorkflowInvalidError,
  type WorkflowInvalidReason,
} from '../workflow-invalid.error';
import { validateAndNormalizeWorkflow } from '../workflow-validator';

const terminal = (name: string, outcome = 'approved'): RawWorkflowNode => ({
  name,
  type: 'terminal',
  config: { outcome },
});

const graph = (nodes: readonly RawWorkflowNode[]): RawWorkflowNodeGraphDefinition => ({
  id: 'graph',
  version: 1,
  name: 'Graph',
  nodes: [...nodes],
});

const collectStep = (name: string, edges: Record<string, string>): RawWorkflowNode => ({
  name,
  type: 'form',
  config: { fields: { [`${name}Value`]: { type: 'text', required: true } } },
  edges,
});

const failureOf = (document: unknown): WorkflowInvalidError => {
  try {
    compileNodeGraph(document);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowInvalidError);

    return error as WorkflowInvalidError;
  }

  throw new Error('Expected node graph compilation to fail');
};

const expectInvalid = (document: unknown, reason: WorkflowInvalidReason): void => {
  try {
    compileNodeGraph(document);
    throw new Error('Expected node graph compilation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowInvalidError);
    expect(error).toMatchObject({ code: WORKFLOW_INVALID, reason });
  }
};

describe('isNodeGraphDefinition', () => {
  it('tells the two authored forms apart by the key that carries the flow', () => {
    expect(isNodeGraphDefinition({ nodes: [] })).toBe(true);
    expect(isNodeGraphDefinition({ steps: [] })).toBe(false);
    expect(isNodeGraphDefinition(null)).toBe(false);
    expect(isNodeGraphDefinition([])).toBe(false);
  });
});

describe('compileNodeGraph', () => {
  it('compiles to the step form, in node order, with the first node as the initial step', () => {
    const compiled = compileNodeGraph(
      graph([collectStep('start', { success: 'done' }), terminal('done')]),
    );

    expect(compiled.steps.map((step) => step.name)).toEqual(['start', 'done']);
    expect(compiled.initial).toBe('start');
    expect(compiled.id).toBe('graph');
    expect(compiled.version).toBe(1);
  });

  it('carries the root webhook and score declarations through untouched', () => {
    const compiled = compileNodeGraph({
      ...graph([collectStep('start', { success: 'done' }), terminal('done')]),
      webhook: { notify: { path: 'notify' } },
      scoring: { risk: { min: 0, max: 100 } },
    });

    expect(compiled.webhook).toEqual({ notify: { path: 'notify' } });
    expect(compiled.scoring).toEqual({ risk: { min: 0, max: 100 } });
  });

  it('names the initial step from the node `initial` names, not from its position', () => {
    const compiled = compileNodeGraph({
      ...graph([terminal('done'), collectStep('start', { success: 'done' })]),
      initial: 'start',
    });

    expect(compiled.initial).toBe('start');
  });

  describe('edges', () => {
    it('resolves an edge to the target node’s entry step, not to the node name', () => {
      const compiled = compileNodeGraph(
        graph([
          collectStep('start', { success: 'capture_id_card' }),
          {
            name: 'capture_id_card',
            type: 'document-capture',
            config: { document: 'ID_CARD', sides: 2 },
            edges: { success: 'done' },
          },
          terminal('done'),
        ]),
      );

      // The two-sided capture's entry step is its front, so that is where the edge lands.
      expect(compiled.steps[0].transitions[0].target).toBe('capture_id_card_front');
      expect(compiled.steps.map((step) => step.name)).toEqual([
        'start',
        'capture_id_card_front',
        'capture_id_card_back',
        'done',
      ]);
    });

    it('refuses an unwired port rather than compiling a step that goes nowhere', () => {
      expectInvalid(graph([collectStep('start', {}), terminal('done')]), 'INVALID_TRANSITIONS');
    });

    it('refuses an edge naming a port the node type does not expose', () => {
      expectInvalid(
        graph([collectStep('start', { success: 'done', verified: 'done' }), terminal('done')]),
        'INVALID_TRANSITIONS',
      );
    });

    it('refuses an edge naming a node that is not in the graph', () => {
      expectInvalid(graph([collectStep('start', { success: 'nowhere' })]), 'UNKNOWN_TARGET');
    });
  });

  describe('sub-step naming', () => {
    it('suffixes a generated sub-step with its key', () => {
      const compiled = compileNodeGraph(
        graph([
          {
            name: 'phone',
            type: 'otp-verify',
            config: {
              channel: 'sms',
              recipientField: 'phoneNumber',
              connector: { id: 'twilio_verify' },
            },
            edges: { verified: 'done', refused: 'refused' },
          },
          terminal('done'),
          terminal('refused', 'rejected'),
        ]),
      );

      expect(compiled.steps.map((step) => step.name)).toEqual([
        'phone',
        'phone_verify',
        'phone_resend',
        'done',
        'refused',
      ]);
    });

    it('honours a rename, so a client built against the old step names keeps working', () => {
      const compiled = compileNodeGraph(
        graph([
          {
            name: 'phone',
            type: 'otp-verify',
            steps: { verify: 'verify_phone_code', resend: 'resend_phone_code' },
            config: {
              channel: 'sms',
              recipientField: 'phoneNumber',
              connector: { id: 'twilio_verify' },
            },
            edges: { verified: 'done', refused: 'refused' },
          },
          terminal('done'),
          terminal('refused', 'rejected'),
        ]),
      );

      expect(compiled.steps.map((step) => step.name)).toEqual([
        'phone',
        'verify_phone_code',
        'resend_phone_code',
        'done',
        'refused',
      ]);
    });

    it('refuses a rename for a sub-step the node type does not have', () => {
      expectInvalid(
        graph([
          { ...collectStep('start', { success: 'done' }), steps: { verify: 'elsewhere' } },
          terminal('done'),
        ]),
        'INVALID_VALUE',
      );
    });

    it('refuses two nodes claiming one step name', () => {
      expectInvalid(
        graph([
          collectStep('start', { success: 'done' }),
          collectStep('start', { success: 'done' }),
          terminal('done'),
        ]),
        'DUPLICATE_STEP_NAME',
      );
    });

    it('refuses a rename that collides with another node’s step', () => {
      expectInvalid(
        graph([
          {
            name: 'phone',
            type: 'otp-verify',
            steps: { verify: 'done' },
            config: {
              channel: 'sms',
              recipientField: 'phoneNumber',
              connector: { id: 'twilio_verify' },
            },
            edges: { verified: 'done', refused: 'done' },
          },
          terminal('done'),
        ]),
        'DUPLICATE_STEP_NAME',
      );
    });
  });

  describe('include', () => {
    it('merges a fragment’s fields after the node type’s own, in declared order', () => {
      const compiled = compileNodeGraph(
        graph([
          {
            name: 'profile',
            type: 'identity-profile',
            config: { nationalities: ['FR'], middleNames: 'omitted' },
            include: [
              { type: 'address', config: { countries: ['FR'] } },
              {
                type: 'form',
                config: { fields: { actingForSelf: { type: 'boolean', required: true } } },
              },
            ],
            edges: { success: 'done' },
          },
          terminal('done'),
        ]),
      );

      // Insertion order is what the client renders, so composition order is the form's layout.
      expect(Object.keys(compiled.steps[0].data)).toEqual([
        'firstName',
        'lastName',
        'dateOfBirth',
        'nationality',
        'street',
        'town',
        'postCode',
        'country',
        'actingForSelf',
      ]);
    });

    it('refuses a fragment that is not composable', () => {
      expectInvalid(
        graph([
          {
            ...collectStep('start', { success: 'done' }),
            include: [{ type: 'terminal', config: { outcome: 'approved' } }],
          },
          terminal('done'),
        ]),
        // The schema's own enum of composable types catches it, which is the better surface: a
        // builder can show the list of fragments rather than only that something was wrong.
        'INVALID_VALUE',
      );
    });

    it('refuses a fragment redeclaring a field the node already contributed', () => {
      expectInvalid(
        graph([
          {
            name: 'profile',
            type: 'identity-profile',
            config: { nationalities: ['FR'] },
            include: [
              { type: 'form', config: { fields: { firstName: { type: 'text', required: true } } } },
            ],
            edges: { success: 'done' },
          },
          terminal('done'),
        ]),
        'DUPLICATE_FIELD_NAME',
      );
    });

    it('refuses two nodes claiming one canonical role', () => {
      expectInvalid(
        graph([
          {
            name: 'first',
            type: 'address',
            config: { countries: ['FR'] },
            edges: { success: 'second' },
          },
          {
            name: 'second',
            type: 'address',
            config: { countries: ['DE'] },
            edges: { success: 'done' },
          },
          terminal('done'),
        ]),
        'DUPLICATE_FIELD_NAME',
      );
    });

    it('lets a prefixed second address coexist, because it claims no role', () => {
      const compiled = compileNodeGraph(
        graph([
          {
            name: 'home',
            type: 'address',
            config: { countries: ['FR'] },
            edges: { success: 'post' },
          },
          {
            name: 'post',
            type: 'address',
            config: { countries: ['FR'], prefix: 'mailing' },
            edges: { success: 'done' },
          },
          terminal('done'),
        ]),
      );

      expect(Object.keys(compiled.steps[1].data)).toEqual([
        'mailingStreet',
        'mailingTown',
        'mailingPostCode',
        'mailingCountry',
      ]);
    });
  });

  it.each(['constructor', '__proto__', 'hasOwnProperty'])(
    'refuses a node named `%s`, which a plain object already answers to',
    (name) => {
      // A bare object lookup by that name finds `Object.prototype`'s member instead of "nothing" —
      // a false duplicate, or an edge resolving to a function. Refused at the schema, naming the node.
      expectInvalid(
        graph([collectStep(name, { success: 'done' }), terminal('done')]),
        'INVALID_VALUE',
      );
    },
  );

  it('refuses a hand-written field named after an Object.prototype member', () => {
    expectInvalid(
      graph([
        {
          name: 'start',
          type: 'form',
          config: { fields: { toString: { type: 'text', required: true } } },
          edges: { success: 'done' },
        },
        terminal('done'),
      ]),
      'INVALID_VALUE',
    );
  });

  describe('a port the author names', () => {
    // A port becomes a key in `edges` and in the map of targets a type reads by bare index. Let
    // through, `__proto__` never lands as an own property of that map — the assignment hits
    // `Object.prototype`'s setter and does nothing — so the type reads `Object.prototype` back
    // where it expects a token, and the compiler crashes on it instead of failing the document.
    it.each(['__proto__', 'constructor'])(
      'refuses a decision branch whose port is `%s`, naming the port',
      (port) => {
        const failure = failureOf(
          graph([
            collectStep('start', { success: 'fork' }),
            {
              name: 'fork',
              type: 'decision',
              config: {
                branches: [{ port, when: { field: 'startValue', equals: 'x' } }],
                fallback: true,
              },
              edges: { default: 'done' },
            },
            terminal('done'),
          ]),
        );

        expect(failure).toMatchObject({
          reason: 'INVALID_VALUE',
          path: 'nodes[1].config.branches[0].port',
        });
      },
    );

    it('refuses a risk-score band whose port is `__proto__`, naming the port', () => {
      const failure = failureOf(
        graph([
          collectStep('start', { success: 'assess' }),
          {
            name: 'assess',
            type: 'risk-score',
            config: {
              rules: [{ score: 'risk', when: { field: 'startValue', isSet: true }, add: 40 }],
              bands: [{ port: '__proto__', score: 'risk', gte: 40 }],
              fallback: true,
            },
            edges: { default: 'done' },
          },
          terminal('done'),
        ]),
      );

      expect(failure).toMatchObject({
        reason: 'INVALID_VALUE',
        path: 'nodes[1].config.bands[0].port',
      });
    });

    it('refuses an edge keyed by `__proto__`, which JSON can spell and a plain object cannot hold', () => {
      // `JSON.parse` does create an own `__proto__` property, so a document can carry the key;
      // it is refused at the schema before the compiler builds any lookup from it.
      const failure = failureOf(
        graph([
          {
            ...collectStep('start', {}),
            edges: JSON.parse('{"__proto__": "done", "success": "done"}') as Record<string, string>,
          },
          terminal('done'),
        ]),
      );

      expect(failure).toMatchObject({ reason: 'INVALID_VALUE' });
      expect(failure.path).toMatch(/^nodes\[0\]\.edges/);
    });
  });

  it('names where a failure is, as a path into the document', () => {
    try {
      compileNodeGraph(graph([collectStep('start', { success: 'nowhere' }), terminal('done')]));
      throw new Error('Expected node graph compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowInvalidError);
      expect((error as WorkflowInvalidError).path).toBe('nodes[0].edges.success');
      // The message stays the stable code: a path names things from the document, and it must not.
      expect((error as Error).message).toBe('WORKFLOW_INVALID');
    }
  });

  it('refuses an unknown node type', () => {
    expectInvalid(graph([{ name: 'start', type: 'teleport' }]), 'INVALID_VALUE');
  });

  it('produces a document the step validator accepts unchanged', () => {
    const document = graph([collectStep('start', { success: 'done' }), terminal('done')]);

    expect(validateAndNormalizeWorkflow(document).stepsByName.start.terminal).toBe(false);
    expect(validateAndNormalizeWorkflow(document).stepsByName.done.terminal).toBe(true);
  });
});
