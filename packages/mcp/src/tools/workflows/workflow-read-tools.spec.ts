import { FieldClassLookup } from '../../classification/field-class-lookup';
import { EngineClient } from '../../engine/engine-client';
import { EngineError } from '../../engine/engine-error';
import { FieldClass } from '../../masking/masking.constants';
import { RequestContext } from '../../request-context/request-context';
import { CompileWorkflowTool } from './compile-workflow.tool';
import { GetWorkflowVersionTool } from './get-workflow-version.tool';
import { ListWorkflowsTool } from './list-workflows.tool';
import { buildCompiledWorkflow } from './workflow-test-fixtures';
import { WorkflowVersionReader } from './workflow-version-reader';

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

describe('workflow read tools', () => {
  describe('list_workflows', () => {
    it('lists every page of workflows with their versions', async () => {
      const request = jest.fn((_method: string, path: string, _context: unknown, args) => {
        if (path === '/v1/admin/workflows') {
          return Promise.resolve({
            items: [
              {
                workflowId: `flow-${args.query.page}`,
                name: null,
                scope: 'users',
                servingVersion: 1,
                inProgressCount: 2,
              },
            ],
            meta: { pagination: { page: args.query.page, totalPages: 2 } },
          });
        }
        return Promise.resolve({ items: [{ version: 1, status: 'published', createdAt: 'x' }] });
      });

      const result = await new ListWorkflowsTool({ request } as unknown as EngineClient).handler(
        {},
        CONTEXT,
      );

      expect(result).toEqual({
        truncated: false,
        workflows: [
          {
            workflowId: 'flow-1',
            name: null,
            scope: 'users',
            servingVersion: 1,
            inProgressCount: 2,
            versions: [{ version: 1, status: 'published' }],
          },
          {
            workflowId: 'flow-2',
            name: null,
            scope: 'users',
            servingVersion: 1,
            inProgressCount: 2,
            versions: [{ version: 1, status: 'published' }],
          },
        ],
      });
    });
  });

  describe('get_workflow_version', () => {
    function buildTool() {
      const definition = buildCompiledWorkflow(1);
      const request = jest.fn((method: string, path: string) => {
        if (path.endsWith('/document')) {
          return Promise.resolve({ status: 'published', document: {} });
        }
        if (method === 'post') {
          return Promise.resolve({ definition });
        }
        return Promise.resolve({
          steps: [
            {
              name: 'check_identity',
              connectors: [
                { name: 'kyc', id: 'veriff_kyc', authoredId: 'mock_kyc_1', selected: true },
              ],
            },
          ],
        });
      });
      const engine = { request } as unknown as EngineClient;
      const classes = {
        getVersionClasses: jest.fn().mockResolvedValue({
          classes: new Map([
            ['email', { class: FieldClass.PSEUDONYMISE, format: 'email' }],
            ['country', { class: FieldClass.PASS }],
          ]),
        }),
      } as unknown as FieldClassLookup;

      return new GetWorkflowVersionTool(engine, new WorkflowVersionReader(engine), classes);
    }

    it('returns steps with the masking class of every field and the selected connector', async () => {
      const result = (await buildTool().handler(
        { workflowId: 'analyst-investigation', version: 1 },
        CONTEXT,
      )) as { steps: Array<{ name: string; fields: unknown[]; connectors: unknown[] }> };

      expect(result).toMatchObject({
        workflowId: 'analyst-investigation',
        status: 'published',
        scores: { risk: { min: 0, max: 100 } },
      });
      expect(result.steps[0].fields).toEqual([
        { name: 'email', type: 'text', required: true, maskingClass: 'pseudonymise' },
        { name: 'country', type: 'text', required: true, maskingClass: 'pass' },
        { name: 'firstName', type: 'text', required: true, maskingClass: 'drop' },
      ]);
      expect(result.steps[0]).toMatchObject({
        scoringRules: [{ score: 'risk', add: 40 }],
        transitions: [{ when: { score: 'risk', gte: 60 } }, { target: 'check_identity' }],
      });
      expect(result.steps[1].connectors).toEqual([
        { name: 'kyc', id: 'veriff_kyc', type: 'kyc', selected: true, authoredId: 'mock_kyc_1' },
      ]);
    });

    it('says which versions exist when the version is unknown', async () => {
      const request = jest.fn().mockRejectedValue(new EngineError('x', HTTP_NOT_FOUND));
      const reader = new WorkflowVersionReader({ request } as unknown as EngineClient);

      await expect(reader.getCompiled({ workflowId: 'a', version: 9 }, CONTEXT)).rejects.toThrow(
        'has no version 9',
      );
    });
  });

  describe('compile_workflow', () => {
    it('returns the reason code and path when the engine refuses the document', async () => {
      const request = jest.fn().mockRejectedValue(
        new EngineError('x', HTTP_BAD_REQUEST, 'WORKFLOW_INVALID', {
          code: 'WORKFLOW_INVALID',
          message: 'WORKFLOW_INVALID',
          reason: 'INVALID_VALUE',
          path: 'steps',
        }),
      );

      const result = await new CompileWorkflowTool({ request } as unknown as EngineClient).handler(
        { document: { id: 'x', version: 1, steps: [] } },
        CONTEXT,
      );

      expect(result).toEqual({
        ok: false,
        code: 'WORKFLOW_INVALID',
        reason: 'INVALID_VALUE',
        path: 'steps',
      });
    });

    it('returns the step names and score bounds when it compiles', async () => {
      const request = jest.fn().mockResolvedValue({ definition: buildCompiledWorkflow(1) });

      const result = await new CompileWorkflowTool({ request } as unknown as EngineClient).handler(
        { document: { id: 'analyst-investigation', version: 1, steps: [{}] } },
        CONTEXT,
      );

      expect(result).toMatchObject({
        ok: true,
        workflowId: 'analyst-investigation',
        steps: ['collect_profile', 'check_identity', 'approved', 'rejected'],
        scores: { risk: { min: 0, max: 100 } },
      });
    });

    it('lets a transport failure through rather than calling the document invalid', async () => {
      const request = jest.fn().mockRejectedValue(new EngineError('unreachable'));

      await expect(
        new CompileWorkflowTool({ request } as unknown as EngineClient).handler(
          { document: {} },
          CONTEXT,
        ),
      ).rejects.toThrow('unreachable');
    });
  });
});
