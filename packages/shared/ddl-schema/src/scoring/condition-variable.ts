/**
 * Marks an engine-provided condition variable rather than a workflow-declared field. A workflow
 * field may not be declared with this prefix, so the two namespaces can never collide and the
 * condition normalizer can tell them apart by name alone.
 */
export const CONDITION_VARIABLE_PREFIX = '$';

/**
 * The onboarding's current score, injected into the transition condition context only — never
 * into a field-level `when`. The first, and so far only, condition variable; the prefix above is
 * what keeps the seam open for a future one without adding more now.
 */
export const SCORE_CONDITION_VARIABLE = '$score';

/**
 * Scalar type each condition variable resolves to, so the normalizer can check a comparison
 * literal without hard-coding the variable name at every call site.
 */
export const CONDITION_VARIABLE_TYPES: Readonly<Record<string, 'number'>> = {
  [SCORE_CONDITION_VARIABLE]: 'number',
};

/** Whether `name` names an engine-provided condition variable rather than a workflow field. */
export const isConditionVariable = (name: string): boolean =>
  name.startsWith(CONDITION_VARIABLE_PREFIX);
