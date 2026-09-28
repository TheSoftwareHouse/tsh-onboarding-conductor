import { getWorkflowJsonSchema } from '../schema/workflow-json-schema';
import {
  BUILT_IN_STEP_TYPES,
  findStepType,
  getStepTypeRegistryVersion,
  listStepTypeNames,
  listStepTypes,
  registerStepType,
} from './step-type.registry';
import { STEP_CATEGORIES, type WorkflowStepTypeDefinition } from './step-type.port';
import { compileWorkflow } from './workflow.compiler';
import { validateAndNormalizeWorkflow } from '../workflow-validator';

describe('the step type registry', () => {
  it('ships every type the palette is documented to offer', () => {
    expect(listStepTypeNames()).toEqual([
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
      'connector-call',
      'wait-for-external',
      'custom',
      'terminal',
    ]);
  });

  it('gives every type a known category and a unique name', () => {
    const names = BUILT_IN_STEP_TYPES.map((stepType) => stepType.type);

    expect(new Set(names).size).toBe(names.length);
    for (const stepType of BUILT_IN_STEP_TYPES) {
      expect(STEP_CATEGORIES).toContain(stepType.category);
    }
  });

  it('keeps every composable type to one step, no ports and no connectors', () => {
    for (const stepType of listStepTypes().filter((candidate) => candidate.composable === true)) {
      const config = stepType.parseConfig(minimalConfigFor(stepType.type), (reason) => {
        throw new Error(`${stepType.type}: ${reason}`);
      });

      // A fragment contributes fields to someone else's step, so it must have exactly one of its
      // own and no control flow to lose when it is merged.
      expect(stepType.listSubStepKeys(config)).toEqual([null]);
      expect(stepType.listPorts(config).map((port) => port.name)).toEqual(['success']);
    }
  });

  it('mounts an external type and rebuilds the schema around it', () => {
    const before = getStepTypeRegistryVersion();
    const schemaBefore = getWorkflowJsonSchema();

    registerStepType(waitingRoomStepType);

    expect(getStepTypeRegistryVersion()).toBe(before + 1);
    expect(findStepType('waiting-room')).toBe(waitingRoomStepType);

    const schemaAfter = getWorkflowJsonSchema();
    expect(schemaAfter).not.toBe(schemaBefore);
    expect(
      (schemaAfter.definitions as Record<string, { properties: { type: { enum: string[] } } }>).step
        .properties.type.enum,
    ).toContain('waiting-room');

    const compiled = compileWorkflow({
      id: 'mounted',
      version: 1,
      steps: [
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
    registerStepType({
      ...waitingRoomStepType,
      type: 'misnamed-room',
      // Declares one sub-step named after the step, then emits a step under another name.
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
      compileWorkflow({
        id: 'misnamed',
        version: 1,
        steps: [
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

const waitingRoomStepType: WorkflowStepTypeDefinition<{ note: string }> = {
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

describe('a compiled step the compiled schema refuses', () => {
  it('is reported at the step whose type produced it, never in the coordinates of the compiled document', () => {
    // A type defect: the descriptor it emits is not one the compiled schema knows. Nothing the author
    // wrote corresponds to it, so the step is what gets named.
    registerStepType({
      type: 'broken-collector',
      category: 'collect',
      buildConfigSchema: () => ({ type: 'object', additionalProperties: false, properties: {} }),
      parseConfig: () => ({}),
      listPorts: () => [{ name: 'success' }],
      listSubStepKeys: () => [null],
      buildFields: () => ({}),
      compile: (context) => [
        {
          name: context.stepNames[0],
          status: 'awaiting_user',
          data: { note: { type: 'text', required: 'yes' as unknown as boolean } },
          transitions: [{ status: 'success', target: context.targets.success }],
        },
      ],
    });

    expect(() =>
      validateAndNormalizeWorkflow({
        id: 'broken',
        version: 1,
        steps: [
          {
            name: 'ok',
            type: 'form',
            config: { fields: { a: { type: 'text', required: true } } },
            edges: { success: 'bad' },
          },
          { name: 'bad', type: 'broken-collector', edges: { success: 'done' } },
          { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
        ],
      }),
    ).toThrow(expect.objectContaining({ reason: 'INVALID_SHAPE', path: 'steps[1]' }));
  });
});
