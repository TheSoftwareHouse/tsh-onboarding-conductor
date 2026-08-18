import { parseClientWebhookSigningSecrets } from './client-webhook-signing-secrets.config';

describe('parseClientWebhookSigningSecrets', () => {
  const secretOf = (length: number): string => 'a'.repeat(length);

  it('parses configured keys in declaration order', () => {
    const secrets = parseClientWebhookSigningSecrets(
      `{"2026-08":"${secretOf(32)}","2026-09":"${secretOf(48)}"}`,
    );

    expect(secrets).toEqual([
      { keyId: '2026-08', secret: secretOf(32) },
      { keyId: '2026-09', secret: secretOf(48) },
    ]);
  });

  it('treats missing, empty and blank values as no configured keys', () => {
    expect(parseClientWebhookSigningSecrets(undefined)).toEqual([]);
    expect(parseClientWebhookSigningSecrets('')).toEqual([]);
    expect(parseClientWebhookSigningSecrets('   ')).toEqual([]);
    expect(parseClientWebhookSigningSecrets('{}')).toEqual([]);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseClientWebhookSigningSecrets('{not json')).toThrow(
      'CLIENT_WEBHOOK_SIGNING_SECRETS must be valid JSON',
    );
  });

  it('rejects a non-object root', () => {
    expect(() => parseClientWebhookSigningSecrets('[]')).toThrow(
      'CLIENT_WEBHOOK_SIGNING_SECRETS must be a JSON object',
    );
    expect(() => parseClientWebhookSigningSecrets('"secret"')).toThrow(
      'CLIENT_WEBHOOK_SIGNING_SECRETS must be a JSON object',
    );
  });

  it('rejects a blank key id', () => {
    expect(() => parseClientWebhookSigningSecrets(`{"  ":"${secretOf(32)}"}`)).toThrow(
      'CLIENT_WEBHOOK_SIGNING_SECRETS key ids must be non-empty',
    );
  });

  it('rejects a non-string secret value', () => {
    expect(() => parseClientWebhookSigningSecrets('{"2026-08":1234}')).toThrow(
      'CLIENT_WEBHOOK_SIGNING_SECRETS.2026-08 must be a string',
    );
  });

  it('rejects a secret below the minimum entropy length', () => {
    expect(() => parseClientWebhookSigningSecrets(`{"2026-08":"${secretOf(31)}"}`)).toThrow(
      'CLIENT_WEBHOOK_SIGNING_SECRETS.2026-08 must be at least 32 characters',
    );
  });
});
