import { z } from 'zod';
import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';
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
  | { status: 'ready'; document: WorkflowDocumentInput; id: string; version: number };

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
  };
}

type ReadyUpload = Extract<DraftUpload, { status: 'ready' }>;

const uploadFieldSchema = z.custom<DraftUpload | null>();

// Both sources carry every field, so the form holds one shape; each source checks only its own.
const draftFieldsSchema = z.object({
  workflowId: z.string(),
  version: z.string(),
  name: z.string(),
  upload: uploadFieldSchema,
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

const uploadSourceSchema = draftFieldsSchema.extend({
  source: z.literal('upload'),
  upload: uploadFieldSchema.superRefine((upload, context): upload is ReadyUpload => {
    if (upload?.status === 'ready') {
      return true;
    }
    context.addIssue({ code: z.ZodIssueCode.custom, message: upload?.message ?? UPLOAD_REQUIRED });
    return false;
  }),
});

/** The dialog's values in, the document to post out: the Empty template or the uploaded file as read. */
export const newDraftSchema = z
  .discriminatedUnion('source', [emptySourceSchema, uploadSourceSchema])
  .transform((values): WorkflowDocumentInput => {
    if (values.source === 'upload') {
      return values.upload.document;
    }

    const { workflowId, version, name } = values;
    return { id: workflowId, version, ...(name === '' ? {} : { name }), steps: [] };
  });

export type NewDraftValues = z.input<typeof newDraftSchema>;
