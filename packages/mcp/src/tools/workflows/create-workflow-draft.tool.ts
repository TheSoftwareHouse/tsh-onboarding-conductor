import { HttpStatus, Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import {
  CONFIRMATION_TOKEN_ARGUMENT,
  CONFIRMATION_TTL_MINUTES,
  ConfirmationService,
} from '../../confirmation/confirmation.service';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { EngineError } from '../../engine/engine-error';
import { RequestContext } from '../../request-context/request-context';
import { ToolError } from '../tool-error';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { getDocument, JsonObject } from './workflow-arguments';
import { describeRefusal } from './workflow-version-reader';
import {
  DRAFT_FAMILY_SCOPE,
  MAX_WORKFLOW_NAME_LENGTH,
  WorkflowErrorCode,
  WorkflowToolName,
} from './workflows.constants';

type WorkflowDocument = components['schemas']['WorkflowDocument'];

interface Blocker {
  code: string;
  message: string;
}

@Injectable()
@McpTool()
export class CreateWorkflowDraftTool implements ToolRegistration {
  readonly kind = ToolKind.WRITE;
  readonly name = WorkflowToolName.CREATE_DRAFT;
  readonly description =
    'Proposes a workflow document as a new DRAFT version; it never publishes, and a draft never ' +
    'starts an onboarding. Two steps. Call it first without confirmationToken: nothing is ' +
    'stored; it returns a preview (the engine dry-run compile result, the target family, ' +
    'whether the call would create a family, any existing draft, anything that would make the ' +
    'engine refuse) and, when nothing blocks, a confirmationToken. Show the preview to the ' +
    'analyst and call again with the same arguments plus that token only after they agree. The ' +
    `token is single-use and lasts ${CONFIRMATION_TTL_MINUTES} minutes. \`name\`, when given, ` +
    'replaces the document name and labels a family this call creates.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      document: {
        type: 'object',
        description:
          'A workflow document in its authored form: id, version and typed steps. The id ' +
          'names the family the draft is stored in.',
      },
      name: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_WORKFLOW_NAME_LENGTH,
        description: 'Display label for a family this call creates; overrides document.name.',
      },
      [CONFIRMATION_TOKEN_ARGUMENT]: {
        type: 'string',
        description: "The token from this tool's preview, passed only after the analyst agreed.",
      },
    },
    required: ['document'],
    additionalProperties: false,
  };

  constructor(
    private readonly engine: EngineClient,
    private readonly confirmation: ConfirmationService,
  ) {}

  async handler(args: ToolArguments, context: RequestContext) {
    const document = getDocument(args);
    const body = this.withName(document, args.name);
    const { id, version } = body;

    if (typeof id !== 'string' || typeof version !== 'number') {
      throw new ToolError(
        'The document needs a string id and a numeric version to name the draft it would create.',
      );
    }

    if (args[CONFIRMATION_TOKEN_ARGUMENT] === undefined) {
      return this.preview(args, body, id, version, context);
    }

    this.confirmation.consume(context.identity, this.name, args, args[CONFIRMATION_TOKEN_ARGUMENT]);

    const draft = await this.engine
      .request('post', '/v1/admin/workflows', context, {
        body: body as unknown as WorkflowDocument,
      })
      .catch((error: unknown) => {
        throw error instanceof EngineError ? this.explainRefusal(error, id, version) : error;
      });

    return {
      created: true,
      published: false,
      workflowId: draft.workflowId,
      version: draft.version,
      status: draft.status,
      name: draft.name,
      createdAt: draft.createdAt,
    };
  }

  private withName(document: JsonObject, name: unknown): JsonObject {
    if (name === undefined) {
      return document;
    }

    if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_WORKFLOW_NAME_LENGTH) {
      throw new ToolError(`name must be a string of 1 to ${MAX_WORKFLOW_NAME_LENGTH} characters.`);
    }

    return { ...document, name };
  }

  private async preview(
    args: ToolArguments,
    body: JsonObject,
    id: string,
    version: number,
    context: RequestContext,
  ) {
    const compile = await this.engine
      .request('post', '/v1/admin/workflows/compile', context, {
        body: body as unknown as WorkflowDocument,
      })
      .then(({ definition }) => ({ ok: true, steps: definition.steps.map((step) => step.name) }))
      .catch((error: unknown) => {
        if (
          error instanceof EngineError &&
          (error.status === HttpStatus.BAD_REQUEST || error.status === HttpStatus.CONFLICT)
        ) {
          return { ok: false, ...describeRefusal(error) };
        }
        throw error;
      });

    const { items: families } = await this.engine.request('get', '/v1/admin/workflows', context, {
      query: { search: id, limit: ENGINE_PAGE_SIZE },
    });
    const family = families.find(({ workflowId }) => workflowId === id);
    const stored = family
      ? (
          await this.engine.request('get', '/v1/admin/workflows/{workflowId}/versions', context, {
            path: { workflowId: id },
          })
        ).items
      : [];
    const draft = stored.find(({ status }) => status === 'draft');

    const blockers: Blocker[] = [
      ...(family && family.scope !== DRAFT_FAMILY_SCOPE
        ? [
            {
              code: WorkflowErrorCode.SCOPE_CONFLICT,
              message: `${id} is a ${family.scope} family; drafts can only be added to families in the ${DRAFT_FAMILY_SCOPE} scope. Choose another id.`,
            },
          ]
        : []),
      ...(draft
        ? [
            {
              code: WorkflowErrorCode.DRAFT_EXISTS,
              message: `${id} already has a draft (version ${draft.version}); a family holds at most one. It must be deleted or published first.`,
            },
          ]
        : []),
      ...(stored.some((existing) => existing.version === version)
        ? [
            {
              code: WorkflowErrorCode.VERSION_EXISTS,
              message: `Version ${version} of ${id} already exists. Choose a higher version number.`,
            },
          ]
        : []),
    ];
    const issuable = blockers.length === 0;

    return {
      dryRun: true,
      target: {
        workflowId: id,
        version,
        name: typeof body.name === 'string' ? body.name : (family?.name ?? null),
        familyExists: family !== undefined,
        scope: family?.scope ?? DRAFT_FAMILY_SCOPE,
        wouldCreateFamily: family === undefined,
      },
      existingDraft: draft ? { version: draft.version } : null,
      compile,
      blockers,
      ...(issuable
        ? {
            confirmationToken: this.confirmation.issue(context.identity, this.name, args),
            tokenValidMinutes: CONFIRMATION_TTL_MINUTES,
          }
        : {}),
      next: issuable
        ? 'Nothing was stored. Show this preview to the analyst; only if they agree, call again with the same arguments and the confirmationToken.'
        : 'Nothing was stored and no confirmation token was issued: resolve the blockers first.',
    };
  }

  private explainRefusal(error: EngineError, id: string, version: number): ToolError | EngineError {
    const details = describeRefusal(error);

    switch (error.code) {
      case WorkflowErrorCode.DRAFT_EXISTS:
        return new ToolError(
          `Nothing was created: ${id} already has a draft (version ${String(details.draftVersion)}); a family holds at most one. Delete or publish it first.`,
        );
      case WorkflowErrorCode.VERSION_EXISTS:
        return new ToolError(
          `Nothing was created: version ${version} of ${id} already exists. Choose a higher version number.`,
        );
      case WorkflowErrorCode.SCOPE_CONFLICT:
        return new ToolError(
          `Nothing was created: ${id} belongs to a ${String(details.scope)} family, and drafts can only be added to families in the ${DRAFT_FAMILY_SCOPE} scope. Choose another id.`,
        );
      case WorkflowErrorCode.INVALID:
        return new ToolError(
          `Nothing was created: the engine refused the document (${JSON.stringify(details)}). Fix it, check it with compile_workflow and propose it again.`,
        );
      default:
        return error;
    }
  }
}
