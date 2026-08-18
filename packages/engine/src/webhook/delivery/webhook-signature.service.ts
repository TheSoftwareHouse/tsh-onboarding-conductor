import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import {
  ClientWebhookSigningSecrets,
  parseClientWebhookSigningSecrets,
} from '../../config/client-webhook-signing-secrets.config';

/** Signature scheme identifier carried by every entry of the signature header. */
const SIGNATURE_SCHEME = 'v1';

export const WEBHOOK_TIMESTAMP_HEADER = 'X-Webhook-Timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'X-Webhook-Signature';

export type WebhookSignatureHeaders = Readonly<Record<string, string>>;

@Injectable()
export class WebhookSignatureService {
  private readonly signingSecrets: ClientWebhookSigningSecrets;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.signingSecrets = parseClientWebhookSigningSecrets(
      configService.get<string>('CLIENT_WEBHOOK_SIGNING_SECRETS'),
    );
  }

  /**
   * Signs the exact request body about to be sent. The timestamp is part of the signed string so
   * clients can reject replays outside their tolerance window, and it is regenerated per attempt.
   */
  buildHeaders(body: string, signedAt: Date): WebhookSignatureHeaders {
    if (this.signingSecrets.length === 0) {
      throw new Error('CLIENT_WEBHOOK_SIGNING_SECRETS must define at least one signing key');
    }

    const timestamp = Math.floor(signedAt.getTime() / 1000);
    const signedPayload = `${timestamp}.${body}`;
    const signatures = this.signingSecrets.map(
      ({ secret }) =>
        `${SIGNATURE_SCHEME}=${createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')}`,
    );

    return {
      [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
      [WEBHOOK_SIGNATURE_HEADER]: signatures.join(' '),
    };
  }
}
