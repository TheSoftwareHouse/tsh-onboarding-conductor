export type ClientWebhookSigningSecret = Readonly<{
  keyId: string;
  secret: string;
}>;

export type ClientWebhookSigningSecrets = readonly ClientWebhookSigningSecret[];

/** Shortest secret that still carries 256 bits of entropy in a printable encoding. */
const MIN_SECRET_LENGTH = 32;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parses the active outbound signing keys. Every configured key signs each delivery, so a
 * rotation is completed by adding the new key, letting clients accept both, then dropping the old.
 */
export function parseClientWebhookSigningSecrets(
  raw: string | undefined,
): ClientWebhookSigningSecrets {
  const trimmed = raw?.trim() ?? '';

  if (trimmed.length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('CLIENT_WEBHOOK_SIGNING_SECRETS must be valid JSON');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('CLIENT_WEBHOOK_SIGNING_SECRETS must be a JSON object');
  }

  const secrets: ClientWebhookSigningSecret[] = [];

  for (const [keyId, secret] of Object.entries(parsed)) {
    if (keyId.trim().length === 0) {
      throw new Error('CLIENT_WEBHOOK_SIGNING_SECRETS key ids must be non-empty');
    }

    if (typeof secret !== 'string') {
      throw new Error(`CLIENT_WEBHOOK_SIGNING_SECRETS.${keyId} must be a string`);
    }

    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `CLIENT_WEBHOOK_SIGNING_SECRETS.${keyId} must be at least ${MIN_SECRET_LENGTH} characters`,
      );
    }

    secrets.push({ keyId, secret });
  }

  return secrets;
}
