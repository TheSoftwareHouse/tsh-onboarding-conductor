import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';

const SOURCE_KEY = 'sourceKey';

/** A connector source key derived from a workflow id, e.g. `eu-b2c-kyc` → `eu_b2c_kyc`. */
export function buildSourceKey(workflowId: string): string {
  return workflowId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/** Renames every `sourceKey` in the document to one derived from `workflowId`; shared keys stay shared. */
export function renameSourceKeys(
  document: WorkflowDocumentInput,
  workflowId: string,
): WorkflowDocumentInput {
  const base = buildSourceKey(workflowId);
  const renamed = new Map<string, string>();

  const rename = (key: string): string => {
    const known = renamed.get(key);
    if (known !== undefined) return known;
    const next = renamed.size === 0 ? base : `${base}_${renamed.size + 1}`;
    renamed.set(key, next);
    return next;
  };

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [
        key,
        key === SOURCE_KEY && typeof member === 'string' ? rename(member) : walk(member),
      ]),
    );
  };

  return walk(document) as WorkflowDocumentInput;
}
