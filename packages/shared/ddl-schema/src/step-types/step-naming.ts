/** `ID_CARD` → `idCard`, so a field name derived from a document type reads as one. */
export const toCamelCase = (value: string): string => {
  const [head, ...rest] = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

  if (head === undefined) {
    return '';
  }

  return [head, ...rest.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)].join('');
};

export const capitalize = (value: string): string =>
  value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

/** `passportDocument` → `passportDocumentId`: the connector payload key carries an id, not a file. */
export const toDocumentPayloadKey = (field: string): string => `${field}Id`;

/**
 * Resolves a step's step names from the sub-step keys its type declared. A `null` key is the
 * step's own name; any other becomes `<step>_<key>` unless `steps` renames it.
 */
export const resolveStepNames = (
  stepName: string,
  subStepKeys: readonly (string | null)[],
  overrides: Readonly<Record<string, string>>,
): string[] =>
  subStepKeys.map((key) => (key === null ? stepName : (overrides[key] ?? `${stepName}_${key}`)));
