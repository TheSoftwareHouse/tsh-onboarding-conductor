import { Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { RequestContext } from '../../request-context/request-context';
import { mapWithConcurrency } from '../shared/map-with-concurrency';
import { ENGINE_READ_CONCURRENCY } from '../shared/shared.constants';
import { McpTool, ToolKind, ToolRegistration } from '../tool-registration';
import { MAX_WORKFLOW_PAGES, WorkflowToolName } from './workflows.constants';

type WorkflowSummary = components['schemas']['AdminWorkflowSummaryResponseDto'];

export interface ListedWorkflow {
  workflowId: string;
  name: string | null;
  scope: WorkflowSummary['scope'];
  servingVersion: number | null;
  inProgressCount: number;
  versions: Array<{ version: number; status: components['schemas']['WorkflowVersionStatus'] }>;
}

@Injectable()
@McpTool()
export class ListWorkflowsTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = WorkflowToolName.LIST;
  readonly description =
    'Lists every onboarding workflow the engine knows: id, display label, scope (built-in, ' +
    'fixtures or users), the version currently served, how many onboardings are still in ' +
    'progress, and every stored version with its status (draft, published or retired). Use it ' +
    'first to find a workflow id and version before reading or comparing versions. Sets ' +
    '`truncated` when there are more workflows than it reads.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
  };

  constructor(private readonly engine: EngineClient) {}

  async handler(_args: object, context: RequestContext) {
    const summaries: WorkflowSummary[] = [];
    let truncated = false;

    for (let page = 1; ; page += 1) {
      const { items, meta } = await this.engine.request('get', '/v1/admin/workflows', context, {
        query: { page, limit: ENGINE_PAGE_SIZE },
      });
      summaries.push(...items);

      if (page >= meta.pagination.totalPages) {
        break;
      }
      if (page >= MAX_WORKFLOW_PAGES) {
        truncated = true;
        break;
      }
    }

    const workflows = await mapWithConcurrency(
      summaries,
      ENGINE_READ_CONCURRENCY,
      async (summary): Promise<ListedWorkflow> => {
        const { items } = await this.engine.request(
          'get',
          '/v1/admin/workflows/{workflowId}/versions',
          context,
          { path: { workflowId: summary.workflowId } },
        );

        return {
          workflowId: summary.workflowId,
          name: summary.name,
          scope: summary.scope,
          servingVersion: summary.servingVersion,
          inProgressCount: summary.inProgressCount,
          versions: items.map(({ version, status }) => ({ version, status })),
        };
      },
    );

    return { workflows, truncated };
  }
}
