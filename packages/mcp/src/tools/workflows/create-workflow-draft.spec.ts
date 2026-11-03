import { ConfirmationService } from '../../confirmation/confirmation.service';
import { EngineClient } from '../../engine/engine-client';
import { EngineError } from '../../engine/engine-error';
import { RequestContext } from '../../request-context/request-context';
import { ToolError } from '../tool-error';
import { CreateWorkflowDraftTool } from './create-workflow-draft.tool';

const CONTEXT: RequestContext = { identity: { kind: 'user', objectId: 'oid-1', upn: 'a@x.test' } };
const OTHER_ANALYST: RequestContext = {
  identity: { kind: 'user', objectId: 'oid-2', upn: 'b@x.test' },
};
const LIST = '/v1/admin/workflows';
const VERSIONS = '/v1/admin/workflows/{workflowId}/versions';
const COMPILE = '/v1/admin/workflows/compile';
const HTTP_CONFLICT = 409;
const HTTP_BAD_REQUEST = 400;
const NEW_VERSION = 2;

const DOCUMENT = { id: 'my-flow', version: NEW_VERSION, steps: [{ type: 'collect' }] };

describe('CreateWorkflowDraftTool', () => {
  let request: jest.Mock;
  let families: Array<{ workflowId: string; name: string | null; scope: string }>;
  let stored: Array<{ version: number; status: string }>;
  let createFailure: EngineError | undefined;
  let compileFailure: EngineError | undefined;
  let tool: CreateWorkflowDraftTool;

  const creations = () =>
    request.mock.calls.filter(([method, path]) => method === 'post' && path === LIST);

  beforeEach(() => {
    families = [];
    stored = [];
    createFailure = undefined;
    compileFailure = undefined;
    request = jest.fn((method: string, path: string, _context: RequestContext, args) => {
      if (path === COMPILE) {
        return compileFailure
          ? Promise.reject(compileFailure)
          : Promise.resolve({ definition: { steps: [{ name: 'collect' }] } });
      }
      if (path === LIST && method === 'get') {
        return Promise.resolve({ items: families, meta: {} });
      }
      if (path === VERSIONS) {
        return Promise.resolve({ items: stored });
      }
      if (createFailure) {
        return Promise.reject(createFailure);
      }
      return Promise.resolve({
        workflowId: args.body.id,
        version: args.body.version,
        status: 'draft',
        name: args.body.name ?? null,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      });
    });
    tool = new CreateWorkflowDraftTool(
      { request } as unknown as EngineClient,
      new ConfirmationService('k'.repeat(32)),
    );
  });

  async function previewOf(args: Record<string, unknown> = { document: DOCUMENT }) {
    return (await tool.handler(args, CONTEXT)) as Record<string, unknown> & {
      confirmationToken?: string;
    };
  }

  it('previews without writing: dry-run compile, new family and a token', async () => {
    const preview = await previewOf();

    expect(creations()).toHaveLength(0);
    expect(preview).toMatchObject({
      dryRun: true,
      compile: { ok: true, steps: ['collect'] },
      target: { workflowId: 'my-flow', version: NEW_VERSION, wouldCreateFamily: true },
      existingDraft: null,
      blockers: [],
    });
    expect(typeof preview.confirmationToken).toBe('string');
  });

  it('reports a compile refusal in the preview and still lets the analyst decide', async () => {
    compileFailure = new EngineError('x', HTTP_BAD_REQUEST, 'WORKFLOW_INVALID', {
      code: 'WORKFLOW_INVALID',
      message: 'WORKFLOW_INVALID',
      reason: 'INVALID_VALUE',
      path: 'steps',
    });

    const preview = await previewOf();

    expect(preview.compile).toEqual({
      ok: false,
      code: 'WORKFLOW_INVALID',
      reason: 'INVALID_VALUE',
      path: 'steps',
    });
    expect(preview.confirmationToken).toBeDefined();
  });

  it('reports an existing family and draft, and issues no token while a draft blocks', async () => {
    families = [{ workflowId: 'my-flow', name: 'My flow', scope: 'users' }];
    stored = [
      { version: 1, status: 'published' },
      { version: 3, status: 'draft' },
    ];

    const preview = await previewOf();

    expect(preview).toMatchObject({
      target: { familyExists: true, wouldCreateFamily: false, scope: 'users' },
      existingDraft: { version: 3 },
      blockers: [{ code: 'WORKFLOW_DRAFT_EXISTS' }],
    });
    expect(preview.confirmationToken).toBeUndefined();
  });

  it('blocks a family in another scope and a version that already exists', async () => {
    families = [{ workflowId: 'my-flow', name: null, scope: 'built-in' }];
    stored = [{ version: NEW_VERSION, status: 'published' }];

    const preview = await previewOf();

    expect(preview.blockers).toEqual([
      expect.objectContaining({ code: 'WORKFLOW_SCOPE_CONFLICT' }),
      expect.objectContaining({ code: 'WORKFLOW_VERSION_EXISTS' }),
    ]);
    expect(preview.confirmationToken).toBeUndefined();
  });

  it('creates exactly one draft when the token from the preview comes back', async () => {
    const args = { document: DOCUMENT, name: 'My flow' };
    const { confirmationToken } = await previewOf(args);

    const result = await tool.handler({ ...args, confirmationToken }, CONTEXT);

    expect(creations()).toHaveLength(1);
    expect(creations()[0][3]).toEqual({ body: { ...DOCUMENT, name: 'My flow' } });
    expect(result).toMatchObject({
      created: true,
      published: false,
      workflowId: 'my-flow',
      version: NEW_VERSION,
      status: 'draft',
      name: 'My flow',
    });
  });

  it('refuses a token reused, changed, foreign or missing a match, and never writes', async () => {
    const { confirmationToken } = await previewOf();

    await expect(
      tool.handler(
        { document: { ...DOCUMENT, version: NEW_VERSION + 1 }, confirmationToken },
        CONTEXT,
      ),
    ).rejects.toThrow('does not match');
    await expect(
      tool.handler({ document: DOCUMENT, confirmationToken }, OTHER_ANALYST),
    ).rejects.toThrow('does not match');
    await expect(
      tool.handler({ document: DOCUMENT, confirmationToken: 'junk' }, CONTEXT),
    ).rejects.toThrow(ToolError);
    expect(creations()).toHaveLength(0);

    await tool.handler({ document: DOCUMENT, confirmationToken }, CONTEXT);
    await expect(tool.handler({ document: DOCUMENT, confirmationToken }, CONTEXT)).rejects.toThrow(
      'already used',
    );
    expect(creations()).toHaveLength(1);
  });

  it.each([
    ['WORKFLOW_DRAFT_EXISTS', { draftVersion: 4 }, 'already has a draft (version 4)'],
    ['WORKFLOW_VERSION_EXISTS', { version: NEW_VERSION }, 'version 2 of my-flow already exists'],
    ['WORKFLOW_SCOPE_CONFLICT', { scope: 'built-in' }, 'belongs to a built-in family'],
    ['WORKFLOW_INVALID', { reason: 'INVALID_VALUE', path: 'steps' }, 'refused the document'],
  ])('explains the engine refusal %s', async (code, details, expected) => {
    const { confirmationToken } = await previewOf();
    createFailure = new EngineError('x', HTTP_CONFLICT, code, { code, message: code, ...details });

    await expect(tool.handler({ document: DOCUMENT, confirmationToken }, CONTEXT)).rejects.toThrow(
      expected,
    );
  });

  it('rejects a document that cannot name a draft before contacting the engine', async () => {
    await expect(tool.handler({ document: { steps: [] } }, CONTEXT)).rejects.toThrow(
      'string id and a numeric version',
    );
    await expect(tool.handler({ document: 'x' }, CONTEXT)).rejects.toThrow('document is required');
    await expect(tool.handler({ document: DOCUMENT, name: '' }, CONTEXT)).rejects.toThrow(
      'name must be',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
