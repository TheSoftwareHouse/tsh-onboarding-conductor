import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';

export type ParsedWorkflowDocument =
  { ok: true; document: WorkflowDocumentInput } | { ok: false; message: string };

function isDocument(value: unknown): value is WorkflowDocumentInput {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the editor's text as a workflow document: any JSON object, valid as a workflow or not. */
export function parseWorkflowDocument(text: string): ParsedWorkflowDocument {
  try {
    const value: unknown = JSON.parse(text);
    return isDocument(value)
      ? { ok: true, document: value }
      : { ok: false, message: 'The document must be a JSON object.' };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}
