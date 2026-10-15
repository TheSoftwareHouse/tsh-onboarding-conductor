import { z } from 'zod';
import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';
import type { WorkflowScope } from '@/api/workflows/admin-workflows';
import {
  MAX_DRAFT_VERSION,
  MAX_WORKFLOW_ID_LENGTH,
  MIN_DRAFT_VERSION,
} from '../constants/new-draft';

const VERSION_PATTERN = /^\d+$/;

// Worded to read under a typed field and an uploaded file alike.
const WORKFLOW_ID_REQUIRED = 'A workflow id is required.';
const WORKFLOW_ID_TOO_LONG = `The workflow id is at most ${MAX_WORKFLOW_ID_LENGTH} characters.`;
const VERSION_INVALID = `The version is a whole number from ${MIN_DRAFT_VERSION} to ${MAX_DRAFT_VERSION}.`;
const UPLOAD_REQUIRED = 'Choose a .json file.';
const UPLOAD_NOT_JSON = 'The file is not valid JSON.';
const FORK_REQUIRED = 'Choose a workflow and a version.';
const UPLOAD_NOT_OBJECT = 'The file must contain a JSON object.';

// The engine's save precondition, shared by the typed fields and an uploaded document.
const workflowIdSchema = z
  .string({ message: WORKFLOW_ID_REQUIRED })
  .min(1, WORKFLOW_ID_REQUIRED)
  .max(MAX_WORKFLOW_ID_LENGTH, WORKFLOW_ID_TOO_LONG);

const draftVersionSchema = z
  .number({ message: VERSION_INVALID })
  .int(VERSION_INVALID)
  .min(MIN_DRAFT_VERSION, VERSION_INVALID)
  .max(MAX_DRAFT_VERSION, VERSION_INVALID);

const draftDocumentSchema = z
  .object({ id: workflowIdSchema, version: draftVersionSchema }, { message: UPLOAD_NOT_OBJECT })
  .passthrough();

export type DraftUpload =
  | { status: 'invalid'; message: string }
  | {
      status: 'ready';
      document: WorkflowDocumentInput;
      id: string;
      version: number;
      name: string;
    };

/** Reads an uploaded file's text as a draft source; only `id` and `version` are required, the editor judges the rest. */
export function parseDraftUpload(text: string): DraftUpload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'invalid', message: UPLOAD_NOT_JSON };
  }

  const result = draftDocumentSchema.safeParse(parsed);
  if (!result.success) {
    return { status: 'invalid', message: result.error.issues[0].message };
  }

  return {
    status: 'ready',
    document: result.data,
    id: result.data.id,
    version: result.data.version,
    name: typeof result.data.name === 'string' ? result.data.name : '',
  };
}

type ReadyUpload = Extract<DraftUpload, { status: 'ready' }>;

const uploadFieldSchema = z.custom<DraftUpload | null>();

/** The version a fork copies: its document, verbatim, and where its family lives. */
export interface ForkSource {
  workflowId: string;
  scope: WorkflowScope;
  document: WorkflowDocumentInput;
}

const forkFieldSchema = z.custom<ForkSource | null>();

// Both sources carry every field, so the form holds one shape; an upload prefills the id and version fields.
const draftFieldsSchema = z.object({
  workflowId: z.string(),
  version: z.string(),
  name: z.string(),
  upload: uploadFieldSchema,
  fork: forkFieldSchema,
});

const emptySourceSchema = draftFieldsSchema.extend({
  source: z.literal('empty'),
  workflowId: z.string().trim().pipe(workflowIdSchema),
  version: z
    .string()
    .trim()
    .regex(VERSION_PATTERN, VERSION_INVALID)
    .transform(Number)
    .pipe(draftVersionSchema),
  name: z.string().trim(),
});

const uploadSourceSchema = emptySourceSchema.extend({
  source: z.literal('upload'),
  upload: uploadFieldSchema.superRefine((upload, context): upload is ReadyUpload => {
    if (upload?.status === 'ready') {
      return true;
    }
    context.addIssue({ code: z.ZodIssueCode.custom, message: upload?.message ?? UPLOAD_REQUIRED });
    return false;
  }),
});

const forkSourceSchema = emptySourceSchema.extend({
  source: z.literal('fork'),
  fork: forkFieldSchema.superRefine((fork, context): fork is ForkSource => {
    if (fork !== null) {
      return true;
    }
    context.addIssue({ code: z.ZodIssueCode.custom, message: FORK_REQUIRED });
    return false;
  }),
});

// The typed id, version and name win over the source document's; an empty name removes the key.
function withIdentity(
  document: WorkflowDocumentInput,
  id: string,
  version: number,
  name: string,
): WorkflowDocumentInput {
  const result = { ...document, id, version, name };
  if (name === '') {
    delete (result as Partial<typeof result>).name;
  }
  return result;
}

/** The dialog's values in, the document to post out: the Empty template, or a fork or upload with the typed id, version and name. */
export const newDraftSchema = z
  .discriminatedUnion('source', [emptySourceSchema, uploadSourceSchema, forkSourceSchema])
  .transform((values): WorkflowDocumentInput => {
    const { workflowId, version, name } = values;
    if (values.source === 'upload') {
      return withIdentity(values.upload.document, workflowId, version, name);
    }
    if (values.source === 'fork') {
      return withIdentity(values.fork.document, workflowId, version, name);
    }

    return { id: workflowId, version, ...(name === '' ? {} : { name }), steps: [] };
  });

export type NewDraftValues = z.input<typeof newDraftSchema>;
