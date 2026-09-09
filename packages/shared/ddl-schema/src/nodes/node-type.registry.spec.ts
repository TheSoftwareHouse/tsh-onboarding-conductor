import { getNodeGraphJsonSchema } from './node-graph.schema';
import {
  BUILT_IN_NODE_TYPES,
  findNodeType,
  getNodeTypeRegistryVersion,
  listNodeTypeNames,
  listNodeTypes,
  registerNodeType,
} from './node-type.registry';
import { NODE_CATEGORIES, type WorkflowNodeTypeDefinition } from './node-type.port';
import { compileNodeGraph } from './node-graph.compiler';

describe('the node type registry', () => {
  it('ships every type the palette is documented to offer', () => {
    expect(listNodeTypeNames()).toEqual([
      'form',
      'contact-details',
      'consents',
      'identity-profile',
      'address',
      'questionnaire',
      'document-choice',
      'document-capture',
      'selfie-capture',
      'otp-verify',
      'kyc-identity-verification',
      'decision',
      'risk-score',
      'manual-review',
      'http-call',
      'notify',
      'wait-for-external',
      'custom-step',
      'terminal',
    ]);
  });

  it('gives every type a known category and a unique name', () => {
    const names = BUILT_IN_NODE_TYPES.map((nodeType) => nodeType.type);

    expect(new Set(names).size).toBe(names.length);
    for (const nodeType of BUILT_IN_NODE_TYPES) {
      expect(NODE_CATEGORIES).toContain(nodeType.category);
    }
  });

  it('keeps every composable type to one step, no ports and no connectors', () => {
    for (const nodeType of listNodeTypes().filter((candidate) => candidate.composable === true)) {
      const config = nodeType.parseConfig(minimalConfigFor(nodeType.type), (reason) => {
        throw new Error(`${nodeType.type}: ${reason}`);
      });

      // A fragment contributes fields to someone else's step, so it must have exactly one of its
      // own and no control flow to lose when it is merged.
      expect(nodeType.listSubStepKeys(config)).toEqual([null]);
      expect(nodeType.listPorts(config).map((port) => port.name)).toEqual(['success']);
    }
  });

  it('mounts an external type and rebuilds the schema around it', () => {
    const before = getNodeTypeRegistryVersion();
    const schemaBefore = getNodeGraphJsonSchema();

    registerNodeType(waitingRoomNodeType);

    expect(getNodeTypeRegistryVersion()).toBe(before + 1);
    expect(findNodeType('waiting-room')).toBe(waitingRoomNodeType);

    const schemaAfter = getNodeGraphJsonSchema();
    expect(schemaAfter).not.toBe(schemaBefore);
    expect(
      (schemaAfter.definitions as Record<string, { properties: { type: { enum: string[] } } }>).node
        .properties.type.enum,
    ).toContain('waiting-room');

    const compiled = compileNodeGraph({
      id: 'mounted',
      version: 1,
      name: 'Mounted',
      nodes: [
        {
          name: 'hold',
          type: 'waiting-room',
          config: { note: 'held' },
          edges: { success: 'done' },
        },
        { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
      ],
    });

    expect(compiled.steps[0].data).toEqual({ waitingRoomNote: { type: 'text', required: true } });
    expect(compiled.steps[0].transitions).toEqual([{ status: 'success', target: 'done' }]);
  });
});

describe('a mounted type that misbehaves', () => {
  it('is refused when the steps it emits are not the ones it declared', () => {
    registerNodeType({
      ...waitingRoomNodeType,
      type: 'misnamed-room',
      // Declares one sub-step named after the node, then emits a step under another name.
      compile: (context) => [
        {
          name: `${context.stepNames[0]}_elsewhere`,
          status: 'awaiting_user',
          data: context.fields,
          transitions: [{ status: 'success', target: context.targets.success }],
        },
      ],
    });

    expect(() =>
      compileNodeGraph({
        id: 'misnamed',
        version: 1,
        name: 'Misnamed',
        nodes: [
          {
            name: 'hold',
            type: 'misnamed-room',
            config: { note: 'held' },
            edges: { success: 'done' },
          },
          { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
        ],
      }),
    ).toThrow('WORKFLOW_INVALID');
  });
});

/** The narrowest config each composable type accepts, so the shared rules can be asserted over all of them. */
const minimalConfigFor = (typeName: string): Record<string, unknown> => {
  switch (typeName) {
    case 'form':
      return { fields: { a: { type: 'text', required: true } } };
    case 'consents':
      return { consents: [{ key: 'terms' }] };
    case 'contact-details':
      return {};
    case 'identity-profile':
    case 'address':
      return typeName === 'address' ? { countries: ['FR'] } : { nationalities: ['FR'] };
    case 'questionnaire':
      return { sections: ['purpose'] };
    default:
      throw new Error(`No minimal config declared for composable type "${typeName}"`);
  }
};

const waitingRoomNodeType: WorkflowNodeTypeDefinition<{ note: string }> = {
  type: 'waiting-room',
  category: 'collect',
  buildConfigSchema: () => ({
    type: 'object',
    additionalProperties: false,
    required: ['note'],
    properties: { note: { type: 'string', minLength: 1 } },
  }),
  parseConfig: (config, fail) =>
    typeof config?.note === 'string' ? { note: config.note } : fail('INVALID_VALUE'),
  listPorts: () => [{ name: 'success' }],
  listSubStepKeys: () => [null],
  buildFields: () => ({ waitingRoomNote: { type: 'text', required: true } }),
  compile: (context) => [
    {
      name: context.stepNames[0],
      status: 'awaiting_user',
      data: context.fields,
      transitions: [{ status: 'success', target: context.targets.success }],
    },
  ],
};
