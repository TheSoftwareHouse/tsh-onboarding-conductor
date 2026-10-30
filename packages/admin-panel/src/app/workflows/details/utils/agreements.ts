import {
  AGREEMENT_KEY_PATTERN,
  type RawWorkflowAgreementDeclaration,
} from '@tsh/ddl-schema/workflow-contract';

export type Agreement = RawWorkflowAgreementDeclaration;

/** Why `key` cannot be the key of `agreements[index]`, or `null` when it can. */
export function findAgreementKeyProblem(
  agreements: readonly Agreement[],
  index: number,
  key: string,
): string | null {
  if (key === '') return 'An agreement needs a key';
  if (!AGREEMENT_KEY_PATTERN.test(key)) return 'Use lowercase letters, digits and -';
  if (agreements.some((agreement, at) => at !== index && agreement.key === key)) {
    return 'Another agreement uses this key';
  }
  return null;
}

/** A free key derived from a field name: `termsAccepted` → `terms-accepted`. */
export function suggestAgreementKey(agreements: readonly Agreement[], field: string): string {
  const base =
    field
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agreement';
  const taken = new Set(agreements.map((agreement) => agreement.key));
  let key = base;
  for (let suffix = 2; taken.has(key); suffix++) key = `${base}-${suffix}`;
  return key;
}
