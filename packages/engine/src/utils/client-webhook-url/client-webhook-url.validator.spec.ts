import { validateClientWebhookUrl } from './client-webhook-url.validator';

describe('validateClientWebhookUrl', () => {
  it('normalizes undefined to undefined', () => {
    expect(validateClientWebhookUrl(undefined, 'development')).toBeUndefined();
  });

  it('normalizes a blank value to undefined', () => {
    expect(validateClientWebhookUrl('   ', 'development')).toBeUndefined();
  });

  it('accepts a valid HTTPS URL', () => {
    expect(validateClientWebhookUrl('https://example.com/webhook', 'production')).toBe(
      'https://example.com/webhook',
    );
  });

  it('accepts a localhost HTTP URL in development', () => {
    expect(validateClientWebhookUrl('http://localhost:8080/hooks/client', 'development')).toBe(
      'http://localhost:8080/hooks/client',
    );
  });

  it('accepts a 127.0.0.1 HTTP URL in development', () => {
    expect(validateClientWebhookUrl('http://127.0.0.1:9999/webhook', 'development')).toBe(
      'http://127.0.0.1:9999/webhook',
    );
  });

  it('accepts an [::1] HTTP URL in development', () => {
    expect(validateClientWebhookUrl('http://[::1]:8080/hooks/client', 'development')).toBe(
      'http://[::1]:8080/hooks/client',
    );
  });

  it('rejects a URL with credentials', () => {
    expect(() =>
      validateClientWebhookUrl('https://user:pass@example.com/webhook', 'production'),
    ).toThrow(/credentials/);
  });

  it('rejects a URL with a fragment', () => {
    expect(() =>
      validateClientWebhookUrl('https://example.com/webhook#fragment', 'production'),
    ).toThrow(/fragments/);
  });

  it('rejects an HTTP URL in production', () => {
    expect(() => validateClientWebhookUrl('http://localhost:8080/webhook', 'production')).toThrow(
      /HTTPS in production/,
    );
  });

  it('rejects a non-loopback HTTP URL', () => {
    expect(() => validateClientWebhookUrl('http://example.com/webhook', 'development')).toThrow(
      /loopback/,
    );
  });

  it('rejects 127.example.com as loopback', () => {
    expect(() => validateClientWebhookUrl('http://127.example.com/webhook', 'development')).toThrow(
      /loopback/,
    );
  });
});
