import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../request-context/request-context';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { getInteger, getString } from '../shared/tool-arguments';
import { diffCompiledWorkflows } from './workflow-diff';
import { WorkflowVersionReader } from './workflow-version-reader';
import { WorkflowToolName } from './workflows.constants';

@Injectable()
@McpTool()
export class DiffWorkflowVersionsTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = WorkflowToolName.DIFF_VERSIONS;
  readonly description =
    'Compares two versions of one workflow, computed from their compiled definitions: steps ' +
    'added or removed; per changed step the fields, transitions, score rules and connectors ' +
    'that were added, removed or changed; and changes to score bounds, agreements, the initial ' +
    'step and the name. A score threshold lives in a transition condition, so a moved threshold ' +
    'appears as a changed transition with its `before` and `after`. Returns `identical: true` ' +
    'when nothing differs. Use it to explain why onboardings on two versions behaved ' +
    'differently, or to review a draft against the version it replaces.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      workflowId: { type: 'string', description: 'The workflow id, e.g. from list_workflows.' },
      fromVersion: { type: 'integer', minimum: 1, description: 'The version to compare from.' },
      toVersion: { type: 'integer', minimum: 1, description: 'The version to compare to.' },
    },
    required: ['workflowId', 'fromVersion', 'toVersion'],
    additionalProperties: false,
  };

  constructor(private readonly reader: WorkflowVersionReader) {}

  async handler(args: ToolArguments, context: RequestContext) {
    const workflowId = getString(args, 'workflowId');
    const fromVersion = getInteger(args, 'fromVersion');
    const toVersion = getInteger(args, 'toVersion');
    const [from, to] = await Promise.all([
      this.reader.getCompiled({ workflowId, version: fromVersion }, context),
      this.reader.getCompiled({ workflowId, version: toVersion }, context),
    ]);

    return {
      workflowId,
      fromVersion,
      fromStatus: from.status,
      toVersion,
      toStatus: to.status,
      ...diffCompiledWorkflows(from.definition, to.definition),
    };
  }
}
