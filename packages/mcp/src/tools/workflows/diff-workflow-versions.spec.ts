import { RequestContext } from '../../request-context/request-context';
import { DiffWorkflowVersionsTool } from './diff-workflow-versions.tool';
import { buildCompiledWorkflow } from './workflow-test-fixtures';
import { CompiledVersion, WorkflowVersionReader } from './workflow-version-reader';

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
const RAISED_THRESHOLD = 75;

describe('DiffWorkflowVersionsTool', () => {
  let versions: Record<number, CompiledVersion>;
  let tool: DiffWorkflowVersionsTool;

  beforeEach(() => {
    versions = {
      1: { status: 'published', definition: buildCompiledWorkflow(1) },
      2: { status: 'draft', definition: buildCompiledWorkflow(2) },
    };
    const reader = {
      getCompiled: jest.fn(({ version }: { version: number }) =>
        Promise.resolve(versions[version]),
      ),
    } as unknown as WorkflowVersionReader;
    tool = new DiffWorkflowVersionsTool(reader);
  });

  const diff = () =>
    tool.handler({ workflowId: 'analyst-investigation', fromVersion: 1, toVersion: 2 }, CONTEXT);

  it('reports identical versions as identical', async () => {
    expect(await diff()).toMatchObject({
      identical: true,
      fromStatus: 'published',
      toStatus: 'draft',
    });
  });

  it('reports a moved threshold as one changed transition with both conditions', async () => {
    versions[2].definition.steps[0].transitions[0] = {
      status: 'success',
      target: 'rejected',
      when: { score: 'risk', gte: RAISED_THRESHOLD },
    };

    const result = await diff();

    expect(result).toMatchObject({
      identical: false,
      steps: {
        added: [],
        removed: [],
        changed: [
          {
            name: 'collect_profile',
            transitions: {
              added: [],
              removed: [],
              changed: [
                {
                  before: { when: { score: 'risk', gte: 60 } },
                  after: { when: { score: 'risk', gte: RAISED_THRESHOLD } },
                },
              ],
            },
          },
        ],
      },
    });
    expect(result).not.toHaveProperty('steps.changed.0.fields');
  });

  it('reports an added step and changed score bounds', async () => {
    versions[2].definition.steps.push({
      name: 'review_identity',
      status: 'awaiting_manual_review',
      data: {},
      transitions: [],
    });
    versions[2].definition.scoring = { risk: { min: 0, max: 200 } };

    expect(await diff()).toMatchObject({
      identical: false,
      scores: {
        changed: [{ name: 'risk', changes: { max: { before: 100, after: 200 } } }],
      },
      steps: { added: ['review_identity'], removed: [], changed: [] },
    });
  });

  it('reports a removed field and a changed field declaration', async () => {
    const { email } = versions[2].definition.steps[0].data;
    versions[2].definition.steps[0].data = {
      email,
      country: { type: 'text', required: false, validation: { oneOf: ['PL', 'RU'] } },
    };

    expect(await diff()).toMatchObject({
      steps: {
        changed: [
          {
            name: 'collect_profile',
            fields: {
              added: [],
              removed: ['firstName'],
              changed: [{ name: 'country', changes: { required: { before: true, after: false } } }],
            },
          },
        ],
      },
    });
  });

  it('reports a changed score rule and a swapped connector', async () => {
    versions[2].definition.steps[0].scoring = [
      { score: 'risk', when: { field: 'country', in: ['RU'] }, add: 55 },
    ];
    versions[2].definition.steps[1].connectors = [
      { name: 'kyc', id: 'veriff_kyc', type: 'kyc', order: 1, fieldMapping: { email: 'email' } },
    ];

    const result = await diff();

    expect(result).toMatchObject({
      steps: {
        changed: [
          { scoringRules: { changed: [{ before: { add: 40 }, after: { add: 55 } }] } },
          {
            name: 'check_identity',
            connectors: {
              changed: [
                { name: 'kyc', changes: { id: { before: 'mock_kyc_1', after: 'veriff_kyc' } } },
              ],
            },
          },
        ],
      },
    });
  });

  it('refuses a missing version number before reading anything', async () => {
    await expect(
      tool.handler({ workflowId: 'analyst-investigation', fromVersion: 1 }, CONTEXT),
    ).rejects.toThrow('toVersion is required');
  });
});
