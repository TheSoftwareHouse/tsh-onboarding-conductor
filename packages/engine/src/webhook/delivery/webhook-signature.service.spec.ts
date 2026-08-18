import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WebhookSignatureService,
} from './webhook-signature.service';

describe('WebhookSignatureService', () => {
  const primarySecret = 'primary-secret-with-enough-entropy';
  const rotatedSecret = 'rotated-secret-with-enough-entropy';

  const createService = (rawSecrets: string): WebhookSignatureService => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CLIENT_WEBHOOK_SIGNING_SECRETS') {
          return rawSecrets;
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService<AppConfig, true>;

    return new WebhookSignatureService(configService);
  };

  const expectedSignature = (secret: string, signedPayload: string): string =>
    createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  it('signs the unix timestamp and body so clients can bound replays', () => {
    const service = createService(`{"2026-08":"${primarySecret}"}`);
    const body = '{"event":{"id":"01912345-6789-7abc-8def-0123456789ab"}}';

    const headers = service.buildHeaders(body, new Date('2026-08-18T10:00:00.000Z'));

    expect(headers).toEqual({
      [WEBHOOK_TIMESTAMP_HEADER]: '1787047200',
      [WEBHOOK_SIGNATURE_HEADER]: `v1=${expectedSignature(primarySecret, `1787047200.${body}`)}`,
    });
  });

  it('emits one signature per active key so rotation needs no coordinated cutover', () => {
    const service = createService(`{"2026-08":"${primarySecret}","2026-09":"${rotatedSecret}"}`);
    const body = '{"payload":true}';

    const headers = service.buildHeaders(body, new Date('2026-08-18T10:00:00.000Z'));

    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toBe(
      [
        `v1=${expectedSignature(primarySecret, `1787047200.${body}`)}`,
        `v1=${expectedSignature(rotatedSecret, `1787047200.${body}`)}`,
      ].join(' '),
    );
  });

  it('produces a different signature when the body changes', () => {
    const service = createService(`{"2026-08":"${primarySecret}"}`);
    const signedAt = new Date('2026-08-18T10:00:00.000Z');

    const original = service.buildHeaders('{"amount":1}', signedAt);
    const tampered = service.buildHeaders('{"amount":2}', signedAt);

    expect(tampered[WEBHOOK_SIGNATURE_HEADER]).not.toBe(original[WEBHOOK_SIGNATURE_HEADER]);
  });

  it('produces a fresh timestamp and signature per attempt', () => {
    const service = createService(`{"2026-08":"${primarySecret}"}`);
    const body = '{"payload":true}';

    const firstAttempt = service.buildHeaders(body, new Date('2026-08-18T10:00:00.000Z'));
    const retry = service.buildHeaders(body, new Date('2026-08-18T10:00:05.000Z'));

    expect(retry[WEBHOOK_TIMESTAMP_HEADER]).not.toBe(firstAttempt[WEBHOOK_TIMESTAMP_HEADER]);
    expect(retry[WEBHOOK_SIGNATURE_HEADER]).not.toBe(firstAttempt[WEBHOOK_SIGNATURE_HEADER]);
  });

  it('refuses to build headers when no signing key is configured', () => {
    const service = createService('{}');

    expect(() => service.buildHeaders('{}', new Date('2026-08-18T10:00:00.000Z'))).toThrow(
      'CLIENT_WEBHOOK_SIGNING_SECRETS must define at least one signing key',
    );
  });
});
