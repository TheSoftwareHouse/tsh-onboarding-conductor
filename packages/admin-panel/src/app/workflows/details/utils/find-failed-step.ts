import { parseWorkflowDocument } from './parse-workflow-document';

/** A failure path's authored step, e.g. `steps[3].edges.success`; the engine restates compiled paths this way. */
const STEP_PATH = /^steps\[(\d+)\]/;

/**
 * The name of the step a compile failure points at, read from the text that was compiled. A name,
 * unlike the index, still finds the step after others are added or removed.
 */
export function findFailedStep(text: string, path: string | undefined): string | null {
  const index = path === undefined ? null : STEP_PATH.exec(path)?.[1];
  if (index === undefined || index === null) return null;
  const parsed = parseWorkflowDocument(text);
  if (!parsed.ok) return null;
  const steps = (parsed.document as { steps?: unknown }).steps;
  const step: unknown = Array.isArray(steps) ? steps[Number(index)] : undefined;
  const name = (step as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' ? name : null;
}
