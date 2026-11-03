import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../request-context/request-context';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { getInteger, getString } from '../shared/tool-arguments';
import { redactHttpRequest } from './workflow-document-redaction';
import { WorkflowVersionReader } from './workflow-version-reader';
import { WorkflowToolName } from './workflows.constants';

@Injectable()
@McpTool()
export class GetWorkflowDocumentTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = WorkflowToolName.GET_DOCUMENT;
  readonly description =
    'Reads one version of a workflow as it was authored (id, version, typed steps), which is the ' +
    'input create_workflow_draft takes: copy `document`, change only what the analyst approved, ' +
    'and give it a new family id when the source family is a fixture or built-in, because a ' +
    'draft can only be written to the users scope. A literal value under an `http_request` ' +
    "connector's request headers or query is replaced by `[redacted]` and its path listed in " +
    '`redactions`; `{{secrets.*}}` placeholders stay. Literal credentials in the request `url` or ' +
    '`body` are NOT redacted. Do not send a redacted value back as a draft: restore it with a ' +
    'secrets placeholder first. For how the engine runs a version, including score thresholds ' +
    'and masking classes, use get_workflow_version.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      workflowId: { type: 'string', description: 'The workflow id, e.g. from list_workflows.' },
      version: { type: 'integer', minimum: 1, description: 'The version number to read.' },
    },
    required: ['workflowId', 'version'],
    additionalProperties: false,
  };

  constructor(private readonly reader: WorkflowVersionReader) {}

  async handler(args: ToolArguments, context: RequestContext) {
    const ref = { workflowId: getString(args, 'workflowId'), version: getInteger(args, 'version') };
    const stored = await this.reader.getStored(ref, context);
    const { document, redactions } = redactHttpRequest(stored.document);

    return {
      workflowId: stored.workflowId,
      version: stored.version,
      status: stored.status,
      document,
      redactions,
    };
  }
}
