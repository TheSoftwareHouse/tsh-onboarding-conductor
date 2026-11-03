import { HttpStatus, Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import { EngineClient } from '../../engine/engine-client';
import { EngineError } from '../../engine/engine-error';
import { RequestContext } from '../../request-context/request-context';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { getDocument } from './workflow-arguments';
import { describeRefusal } from './workflow-version-reader';
import { WorkflowToolName } from './workflows.constants';

type WorkflowDocument = components['schemas']['WorkflowDocument'];

@Injectable()
@McpTool()
export class CompileWorkflowTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = WorkflowToolName.COMPILE;
  readonly description =
    'Checks a workflow document the way the engine does at startup, storing nothing: schema, ' +
    'step types, connector declarations and source-key uniqueness. Returns `ok: true` with the ' +
    'workflow id, version, step names and score bounds, or `ok: false` with the engine reason ' +
    'code and the path into the document where it failed. Use it to validate a document before ' +
    'proposing it as a draft, or to explain why a document is refused.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      document: {
        type: 'object',
        description: 'A workflow document in its authored form: id, version and typed steps.',
      },
    },
    required: ['document'],
    additionalProperties: false,
  };

  constructor(private readonly engine: EngineClient) {}

  async handler(args: ToolArguments, context: RequestContext) {
    const document = getDocument(args);
    const compiled = await this.engine
      .request('post', '/v1/admin/workflows/compile', context, {
        body: document as unknown as WorkflowDocument,
      })
      .catch((error: unknown) => {
        if (
          error instanceof EngineError &&
          (error.status === HttpStatus.BAD_REQUEST || error.status === HttpStatus.CONFLICT)
        ) {
          return error;
        }
        throw error;
      });

    if (compiled instanceof EngineError) {
      return { ok: false, ...describeRefusal(compiled) };
    }

    const { definition } = compiled;

    return {
      ok: true,
      workflowId: definition.id,
      version: definition.version,
      name: definition.name ?? null,
      initialStep: definition.initial ?? definition.steps[0].name,
      steps: definition.steps.map((step) => step.name),
      scores: definition.scoring ?? {},
    };
  }
}
