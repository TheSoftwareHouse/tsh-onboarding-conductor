import { HttpStatus, Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import type { WorkflowVersionRef } from '../../classification/field-class-lookup';
import { EngineClient } from '../../engine/engine-client';
import { EngineError } from '../../engine/engine-error';
import { RequestContext } from '../../request-context/request-context';
import { ToolError } from '../tool-error';
import { isJsonObject } from './workflow-arguments';

export type CompiledWorkflow = components['schemas']['CompiledWorkflowDocument'];
type WorkflowDocument = components['schemas']['WorkflowDocument'];
type WorkflowVersionStatus = components['schemas']['WorkflowVersionStatus'];

export type StoredVersion = components['schemas']['AdminWorkflowVersionDocumentResponseDto'];

export interface CompiledVersion {
  status: WorkflowVersionStatus;
  definition: CompiledWorkflow;
}

/** What the engine refused about a document: its code and every detail it carries but the message. */
export function describeRefusal(error: EngineError): Record<string, unknown> {
  const details = isJsonObject(error.body) ? { ...error.body } : {};
  delete details.message;

  return { code: error.code ?? `HTTP_${error.status}`, ...details };
}

/** The compiled form of a stored version, which is what carries steps, scoring and transitions. */
@Injectable()
export class WorkflowVersionReader {
  constructor(private readonly engine: EngineClient) {}

  /** The authored document of a stored version, verbatim, with the version's status. */
  async getStored(ref: WorkflowVersionRef, context: RequestContext): Promise<StoredVersion> {
    return this.engine
      .request('get', '/v1/admin/workflows/{workflowId}/versions/{version}/document', context, {
        path: ref,
      })
      .catch((error: unknown) => {
        if (error instanceof EngineError && error.status === HttpStatus.NOT_FOUND) {
          throw new ToolError(
            `Workflow ${ref.workflowId} has no version ${ref.version}. Call list_workflows to see the versions that exist.`,
          );
        }
        throw error;
      });
  }

  async getCompiled(ref: WorkflowVersionRef, context: RequestContext): Promise<CompiledVersion> {
    const stored = await this.getStored(ref, context);
    const compiled = await this.engine
      .request('post', '/v1/admin/workflows/compile', context, {
        body: stored.document as unknown as WorkflowDocument,
      })
      .catch((error: unknown) => {
        if (error instanceof EngineError && error.status === HttpStatus.BAD_REQUEST) {
          throw new ToolError(
            `Version ${ref.version} of ${ref.workflowId} (${stored.status}) does not compile, so its structure cannot be read: ${JSON.stringify(describeRefusal(error))}`,
          );
        }
        throw error;
      });

    return { status: stored.status, definition: compiled.definition };
  }
}
