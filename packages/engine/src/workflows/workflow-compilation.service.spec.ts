import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { DuplicateWorkflowSourceKeyError } from './errors/duplicate-workflow-source-key.error';
import { WorkflowConnectorDeclarationInvalidError } from './errors/workflow-connector-declaration-invalid.error';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowSourceKeyConflictException } from './errors/workflow-source-key-conflict.exception';
import { WorkflowCompilationService } from './workflow-compilation.service';
import type { WorkflowRegistryService } from './workflow-registry.service';

const authored = {
  id: 'graph',
  version: 1,
  name: 'Graph',
  steps: [
    {
      name: 'ask',
      type: 'form',
      config: { fields: { email: { type: 'text', required: true } } },
      edges: { success: 'done' },
    },
    { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
  ],
};

/** A registry whose validation answers with whatever the DDL normalizes, or throws what it is told to. */
const createService = (failure?: Error) => {
  const registry = {
    validateDefinition: jest.fn(async (definition: Record<string, unknown>) => {
      if (failure) {
        throw failure;
      }

      const { validateAndNormalizeWorkflow } = await import('@tsh/ddl-schema');

      return validateAndNormalizeWorkflow(definition);
    }),
  } as unknown as WorkflowRegistryService;

  return { service: new WorkflowCompilationService(registry), registry };
};

describe('WorkflowCompilationService', () => {
  it('compiles a workflow and reports the compiled steps, each step and the read-side projection', async () => {
    const { service, registry } = createService();
    const response = await service.compile(authored);

    expect(response.definition.steps.map((step) => step.name)).toEqual(['ask', 'done']);
    expect(response.steps).toEqual([
      {
        name: 'ask',
        type: 'form',
        category: 'collect',
        compiledStepNames: ['ask'],
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
    expect(response.workflow).toMatchObject({ workflowId: 'graph', initialStep: 'ask' });
    // The registry is handed the authored document: its checks are the ones startup would run.
    expect(registry.validateDefinition).toHaveBeenCalledWith(authored);
  });

  it('refuses a document still written as untyped steps, naming the step that lacks a type', async () => {
    const { service } = createService();

    await expect(
      service.compile({
        id: 'untyped',
        version: 1,
        name: 'Untyped',
        steps: [{ name: 'done', status: 'approved', data: {}, transitions: [] }],
      }),
    ).rejects.toMatchObject({
      response: { code: 'WORKFLOW_INVALID', reason: 'INVALID_SHAPE', path: 'steps[0]' },
    });
  });

  it('answers a DDL refusal as a bad request carrying the reason and the path', async () => {
    const { service } = createService();

    await expect(
      service.compile({ ...authored, steps: [{ ...authored.steps[0], edges: {} }] }),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_INVALID',
        reason: 'INVALID_TRANSITIONS',
        path: 'steps[0].edges.success',
      },
    });
    await expect(service.compile('not a document')).rejects.toBeInstanceOf(
      WorkflowInvalidException,
    );
  });

  it("answers an adapter's refusal as a bad request naming the step and the adapter's own words", async () => {
    const { service } = createService(
      new WorkflowConnectorDeclarationInvalidError(
        'ask',
        new Error('Invalid sumsub_kyc connector config key "levelName"'),
      ),
    );

    await expect(service.compile(authored)).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
        stepName: 'ask',
        detail: 'Invalid sumsub_kyc connector config key "levelName"',
      },
    });
    await expect(service.compile(authored)).rejects.toBeInstanceOf(
      WorkflowConnectorDeclarationInvalidException,
    );
  });

  it('answers a source key another workflow owns as a conflict', async () => {
    const { service } = createService(
      new DuplicateWorkflowSourceKeyError('other-workflow', 'graph', 'shared_key'),
    );

    await expect(service.compile(authored)).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_SOURCE_KEY_CONFLICT',
        sourceKey: 'shared_key',
        conflictingWorkflowId: 'other-workflow',
      },
    });
    await expect(service.compile(authored)).rejects.toBeInstanceOf(
      WorkflowSourceKeyConflictException,
    );
  });

  it("leaves the engine's own failures alone", async () => {
    const cause = new Error('connection terminated');
    const { service } = createService(cause);

    await expect(service.compile(authored)).rejects.toBe(cause);
    // Sanity: the DDL error class is not what a plain Error is mapped to.
    expect(cause).not.toBeInstanceOf(WorkflowInvalidError);
  });

  it('lists every step type with the schema a builder renders its config form from', () => {
    const { service } = createService();
    const { stepTypes } = service.listStepTypes();

    expect(stepTypes).toHaveLength(20);
    expect(stepTypes.find((stepType) => stepType.type === 'address')).toMatchObject({
      category: 'collect',
      composable: true,
      connectorTypes: [],
      configSchema: expect.objectContaining({ required: ['countries'] }),
    });
    // The slot is what a builder filters connectors by: an OTP is served by either channel prover.
    expect(stepTypes.find((stepType) => stepType.type === 'otp-verify')?.connectorTypes).toEqual([
      'phone_verification',
      'email_verification',
    ]);
    expect(
      stepTypes.find((stepType) => stepType.type === 'kyc-identity-verification')?.connectorTypes,
    ).toEqual(['kyc']);
    // The generic call declares its connectors in full, so it has no slot to filter by.
    expect(stepTypes.find((stepType) => stepType.type === 'connector-call')).toMatchObject({
      category: 'integrate',
      composable: false,
      connectorTypes: [],
      configSchema: expect.objectContaining({ required: ['connectors'] }),
    });
    expect(service.getWorkflowSchema()).toMatchObject({
      title: 'Onboarding workflow',
    });
  });
});
