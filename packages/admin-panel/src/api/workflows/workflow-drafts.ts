import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { invalidPayloadError, toApiError, type ApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';
import {
  ADMIN_WORKFLOWS_ENDPOINT,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from './workflow-definitions';
import { WORKFLOW_VERSION_STATUS } from './workflow-versions';

const COMPILE_ENDPOINT = `${ADMIN_WORKFLOWS_ENDPOINT}/compile`;

export const WORKFLOW_DRAFT_ERROR_CODES = [
  'WORKFLOW_VERSION_EXISTS',
  'WORKFLOW_DRAFT_EXISTS',
  'WORKFLOW_SCOPE_CONFLICT',
  'WORKFLOW_DRAFT_IN_USE',
  'WORKFLOW_VERSION_NOT_DRAFT',
  'WORKFLOW_VERSION_NOT_LATEST',
  'WORKFLOW_INVALID',
  'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
  'WORKFLOW_SOURCE_KEY_CONFLICT',
  'WORKFLOW_NOT_FOUND',
] as const;

/** The refusals the engine names on a draft route; each gets its own operator-facing copy in the route. */
export type WorkflowDraftErrorCode = (typeof WORKFLOW_DRAFT_ERROR_CODES)[number];

const draftErrorBodySchema = z.object({
  code: z.enum(WORKFLOW_DRAFT_ERROR_CODES),
  reason: z.string().optional(),
  path: z.string().optional(),
  message: z.string().optional(),
});

/** Names the data in `describeRequestFailure`'s role message, so a 403 points at this section. */
const RESOURCE_LABEL = 'workflow drafts';

const MALFORMED_DRAFT_MESSAGE = 'Response contains a malformed workflow draft.';

export function isDraftErrorCode(code: string | null): code is WorkflowDraftErrorCode {
  return WORKFLOW_DRAFT_ERROR_CODES.some((known) => known === code);
}

/** The engine's named refusal with its detail, or `null` for any failure it did not name — auth, network, 5xx. */
export function readDraftError(
  error: ApiError,
): { code: WorkflowDraftErrorCode; reason?: string; path?: string } | null {
  const parsed = draftErrorBodySchema.safeParse(error.body);
  if (!parsed.success) return null;
  const { code, reason, path } = parsed.data;
  return { code, reason, path };
}

const workflowDraftSchema = z.object({
  workflowId: z.string().min(1),
  version: z.number().int().positive(),
  status: z.literal(WORKFLOW_VERSION_STATUS.draft),
  name: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workflowPublicationSchema = workflowDraftSchema.extend({
  status: z.literal(WORKFLOW_VERSION_STATUS.published),
});

const workflowVersionDocumentSchema = workflowDraftSchema.extend({
  status: z.nativeEnum(WORKFLOW_VERSION_STATUS),
  document: z.record(z.string(), z.unknown()),
});

// The authored step report gives the count; the compiled `workflow` is the graph's definition.
const workflowCompilationSchema = z.object({
  steps: z.array(z.unknown()),
  workflow: workflowDefinitionSchema,
});

export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;

/** A draft after publishing: the same summary, now `published`. */
export type WorkflowPublication = z.infer<typeof workflowPublicationSchema>;

/** A version of any status with its stored document, verbatim; a draft's may not compile. */
export type WorkflowVersionDocument = z.infer<typeof workflowVersionDocumentSchema>;

export interface WorkflowCompilation {
  /** How many authored steps the document declares. */
  stepCount: number;
  /** The compiled definition, as the graph renders it. */
  workflow: WorkflowDefinition;
}

/** A workflow document as the editor holds it: any JSON object, valid as a workflow or not. */
export type WorkflowDocumentInput = Record<string, unknown>;

function draftPath(workflowId: string, version: number): string {
  return `${ADMIN_WORKFLOWS_ENDPOINT}/${encodeURIComponent(workflowId)}/versions/${version}`;
}

/** Runs one request and hands back its unvalidated payload, or the ApiError. */
async function requestPayload(request: () => Promise<AxiosResponse<unknown>>): Promise<unknown> {
  try {
    return (await request()).data;
  } catch (cause) {
    throw toApiError(cause, RESOURCE_LABEL, (code) => (isDraftErrorCode(code) ? code : undefined));
  }
}

function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw invalidPayloadError(MALFORMED_DRAFT_MESSAGE);
  }
  return parsed.data;
}

/** Stores a new draft. The family is created in `users` scope when `document.id` names none. */
export async function createWorkflowDraft(document: WorkflowDocumentInput): Promise<WorkflowDraft> {
  const payload = await requestPayload(() =>
    httpClient.post<unknown>(ADMIN_WORKFLOWS_ENDPOINT, document),
  );
  return parseOrThrow(workflowDraftSchema, payload);
}

/** Reads a version's stored document verbatim, whatever its status. */
export async function fetchWorkflowDocument(
  workflowId: string,
  version: number,
): Promise<WorkflowVersionDocument> {
  const payload = await requestPayload(() =>
    httpClient.get<unknown>(`${draftPath(workflowId, version)}/document`),
  );
  return parseOrThrow(workflowVersionDocumentSchema, payload);
}

/** Replaces a draft's document; a changed `id` or `version` in it moves the draft. */
export async function updateWorkflowDraft(
  workflowId: string,
  version: number,
  document: WorkflowDocumentInput,
): Promise<WorkflowDraft> {
  const payload = await requestPayload(() =>
    httpClient.put<unknown>(draftPath(workflowId, version), document),
  );
  return parseOrThrow(workflowDraftSchema, payload);
}

export async function deleteWorkflowDraft(workflowId: string, version: number): Promise<void> {
  await requestPayload(() => httpClient.delete<unknown>(draftPath(workflowId, version)));
}

/** Publishes a stored draft; the engine refuses one at or below a published version with 409 NOT_LATEST. */
export async function publishWorkflowDraft(
  workflowId: string,
  version: number,
): Promise<WorkflowPublication> {
  const payload = await requestPayload(() =>
    httpClient.post<unknown>(`${draftPath(workflowId, version)}/publish`),
  );
  return parseOrThrow(workflowPublicationSchema, payload);
}

/** Dry-runs the engine's compiler over a document without storing anything. */
export async function compileWorkflowDocument(
  document: WorkflowDocumentInput,
): Promise<WorkflowCompilation> {
  const payload = await requestPayload(() => httpClient.post<unknown>(COMPILE_ENDPOINT, document));
  const compilation = parseOrThrow(workflowCompilationSchema, payload);
  return { stepCount: compilation.steps.length, workflow: compilation.workflow };
}
