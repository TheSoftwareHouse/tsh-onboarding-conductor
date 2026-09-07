import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { DuplicateWorkflowSourceKeyError } from './errors/duplicate-workflow-source-key.error';
import { WorkflowConnectorDeclarationInvalidError } from './errors/workflow-connector-declaration-invalid.error';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowSourceKeyConflictException } from './errors/workflow-source-key-conflict.exception';
import { WorkflowCompilationService } from './workflow-compilation.service';
import type { WorkflowRegistryService } from './workflow-registry.service';

const nodeGraph = {
  id: 'graph',
  version: 1,
  name: 'Graph',
  nodes: [
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
  it('compiles a node graph and reports the steps, the nodes and the read-side projection', async () => {
    const { service, registry } = createService();
    const response = await service.compile(nodeGraph);

    expect(response.definition.steps.map((step) => step.name)).toEqual(['ask', 'done']);
    expect(response.nodes).toEqual([
      {
        name: 'ask',
        type: 'form',
        category: 'collect',
        stepNames: ['ask'],
        ports: [{ name: 'success', arms: [{ target: 'done' }] }],
      },
      { name: 'done', type: 'terminal', category: 'terminal', stepNames: ['done'], ports: [] },
    ]);
    expect(response.workflow).toMatchObject({ workflowId: 'graph', initialStep: 'ask' });
    // The registry is handed the compiled step form, so nothing compiles twice.
    expect(registry.validateDefinition).toHaveBeenCalledWith(response.definition);
  });

  it('passes a hand-written document through with no node report', async () => {
    const { service } = createService();
    const response = await service.compile({
      id: 'steps',
      version: 1,
      name: 'Steps',
      steps: [
        {
          name: 'ask',
          status: 'awaiting_user',
          data: { email: { type: 'text', required: true } },
          transitions: [{ status: 'success', target: 'done' }],
        },
        { name: 'done', status: 'approved', data: {}, transitions: [] },
      ],
    });

    expect(response.nodes).toBeNull();
    expect(response.definition.steps).toHaveLength(2);
  });

  it('answers a DDL refusal as a bad request carrying the reason and the path', async () => {
    const { service } = createService();

    await expect(
      service.compile({ ...nodeGraph, nodes: [{ ...nodeGraph.nodes[0], edges: {} }] }),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_INVALID',
        reason: 'INVALID_TRANSITIONS',
        path: 'nodes[0].edges.success',
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

    await expect(service.compile(nodeGraph)).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
        stepName: 'ask',
        detail: 'Invalid sumsub_kyc connector config key "levelName"',
      },
    });
    await expect(service.compile(nodeGraph)).rejects.toBeInstanceOf(
      WorkflowConnectorDeclarationInvalidException,
    );
  });

  it('answers a source key another workflow owns as a conflict', async () => {
    const { service } = createService(
      new DuplicateWorkflowSourceKeyError('other-workflow', 'graph', 'shared_key'),
    );

    await expect(service.compile(nodeGraph)).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_SOURCE_KEY_CONFLICT',
        sourceKey: 'shared_key',
        conflictingWorkflowId: 'other-workflow',
      },
    });
    await expect(service.compile(nodeGraph)).rejects.toBeInstanceOf(
      WorkflowSourceKeyConflictException,
    );
  });

  it("leaves the engine's own failures alone", async () => {
    const cause = new Error('connection terminated');
    const { service } = createService(cause);

    await expect(service.compile(nodeGraph)).rejects.toBe(cause);
    // Sanity: the DDL error class is not what a plain Error is mapped to.
    expect(cause).not.toBeInstanceOf(WorkflowInvalidError);
  });

  it('lists every node type with the schema a builder renders its config form from', () => {
    const { service } = createService();
    const { nodeTypes } = service.listNodeTypes();

    expect(nodeTypes).toHaveLength(18);
    expect(nodeTypes.find((nodeType) => nodeType.type === 'address')).toMatchObject({
      category: 'collect',
      composable: true,
      configSchema: expect.objectContaining({ required: ['countries'] }),
    });
    expect(service.getNodeGraphSchema()).toMatchObject({
      title: 'Onboarding workflow (node graph)',
    });
  });
});
