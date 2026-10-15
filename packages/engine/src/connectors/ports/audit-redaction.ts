/**
 * Replaces each named top-level field of `submittedData` with `<field>Bytes`, the size of its
 * compact JSON, so an audit row records that a large or sensitive value arrived without holding it.
 */
export function redactAuditFields(
  submittedData: unknown,
  fields: readonly string[] | undefined,
): unknown {
  if (
    fields === undefined ||
    fields.length === 0 ||
    typeof submittedData !== 'object' ||
    submittedData === null ||
    Array.isArray(submittedData)
  ) {
    return submittedData;
  }

  const redacted: Record<string, unknown> = { ...submittedData };

  for (const field of fields) {
    if (field in redacted) {
      redacted[`${field}Bytes`] = Buffer.byteLength(JSON.stringify(redacted[field]) ?? '');
      delete redacted[field];
    }
  }

  return redacted;
}
