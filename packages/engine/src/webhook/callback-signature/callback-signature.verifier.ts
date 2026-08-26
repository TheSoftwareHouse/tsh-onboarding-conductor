import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import {
  parseConnectorCallbackSecrets,
  type ConnectorCallbackSecrets,
} from '../../config/connector-callback-secrets.config';
import { parseConnectorCallbackUnsignedTypes } from '../../config/connector-callback-unsigned-types.config';
import type {
  ConnectorAdapter,
  ConnectorCallbackHmacAuth,
  ConnectorCallbackMappingInput,
} from '../../connectors/ports/connector-adapter.port';
import { CallbackSignatureInvalidException } from '../errors/callback-signature-invalid.exception';

export type CallbackSignatureOutcome = 'skipped_unsigned_connector' | 'verified';

type CallbackAuthAdapter = Pick<ConnectorAdapter, 'callbackAuth' | 'id'>;

const HEX_SIGNATURE_PATTERN = /^(?:[0-9a-f]{2})+$/i;
const BASE64_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const EPOCH_SECONDS_PATTERN = /^\d{1,15}$/;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Authenticates an inbound connector callback against the signature recipe its adapter
 * declares. Adapters own the recipe; this class owns the comparison, so timing-safe
 * matching, replay bounding, and failure classification exist exactly once.
 */
@Injectable()
export class CallbackSignatureVerifier {
  private readonly logger = new Logger(CallbackSignatureVerifier.name);
  private readonly secrets: ConnectorCallbackSecrets;
  private readonly unsignedTypes: readonly string[];
  private readonly isProduction: boolean;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.secrets = parseConnectorCallbackSecrets(
      configService.get<string>('CONNECTOR_CALLBACK_SIGNING_SECRETS', { infer: true }),
    );
    this.unsignedTypes = parseConnectorCallbackUnsignedTypes(
      configService.get<string>('CONNECTOR_CALLBACK_UNSIGNED_TYPES', { infer: true }),
    );
    this.isProduction =
      (configService.get<string>('NODE_ENV', { infer: true }) ?? '').trim().toLowerCase() ===
      'production';
  }

  verify(
    adapter: CallbackAuthAdapter,
    input: ConnectorCallbackMappingInput,
  ): CallbackSignatureOutcome {
    const auth = adapter.callbackAuth;

    if (!auth) {
      throw new CallbackSignatureInvalidException('callback_auth_not_declared');
    }

    if (auth.kind === 'none') {
      // Providers that do not sign are a real integration, so unsigned ingress stays possible in
      // production — but only for a connector type the operator named, never by default.
      if (this.isProduction && !this.unsignedTypes.includes(adapter.id)) {
        throw new CallbackSignatureInvalidException('unsigned_connector_not_allowed');
      }

      this.logger.warn(
        `CALLBACK_SIGNATURE_SKIPPED connectorId=${adapter.id} reason=unsigned_connector`,
      );

      return 'skipped_unsigned_connector';
    }

    const secrets = this.secrets[adapter.id];
    if (!secrets || secrets.length === 0) {
      throw new CallbackSignatureInvalidException('signing_secret_missing');
    }

    const signatureHeaderValue = this.findHeaderValue(input.headers, auth.signatureHeader);
    if (!signatureHeaderValue) {
      throw new CallbackSignatureInvalidException('signature_header_missing');
    }

    const timestamp = this.resolveTimestamp(auth, input.headers);
    const signedMessage = auth.buildSignedMessage
      ? auth.buildSignedMessage({ rawBody: input.rawBody, headers: input.headers, timestamp })
      : this.buildSignedMessage(input.rawBody, timestamp);

    const offeredSignatures = (
      auth.parseSignatureHeader?.(signatureHeaderValue) ?? [signatureHeaderValue]
    )
      .map((offered) => this.decodeSignature(offered, auth.encoding))
      .filter((decoded): decoded is Buffer => decoded !== undefined);

    if (offeredSignatures.length === 0) {
      throw new CallbackSignatureInvalidException('signature_malformed');
    }

    // Deliberately exhaustive: no early exit, so elapsed time does not reveal which
    // rotation secret or which offered signature matched.
    let matched = false;
    for (const secret of secrets) {
      const expected = createHmac(auth.algorithm, secret).update(signedMessage).digest();

      for (const offered of offeredSignatures) {
        if (offered.length === expected.length && timingSafeEqual(offered, expected)) {
          matched = true;
        }
      }
    }

    if (!matched) {
      throw new CallbackSignatureInvalidException('signature_mismatch');
    }

    return 'verified';
  }

  private resolveTimestamp(
    auth: ConnectorCallbackHmacAuth,
    headers: ConnectorCallbackMappingInput['headers'],
  ): string | undefined {
    if (!auth.timestamp) {
      return undefined;
    }

    const timestamp = this.findHeaderValue(headers, auth.timestamp.header);
    if (!timestamp || !EPOCH_SECONDS_PATTERN.test(timestamp)) {
      throw new CallbackSignatureInvalidException('timestamp_header_missing');
    }

    const skewSeconds = Math.abs(Date.now() / MILLISECONDS_PER_SECOND - Number(timestamp));
    if (skewSeconds > auth.timestamp.toleranceSeconds) {
      throw new CallbackSignatureInvalidException('timestamp_out_of_tolerance');
    }

    return timestamp;
  }

  private buildSignedMessage(rawBody: Uint8Array, timestamp: string | undefined): Uint8Array {
    if (!timestamp) {
      return rawBody;
    }

    const prefix = new TextEncoder().encode(`${timestamp}.`);
    const signedMessage = new Uint8Array(prefix.byteLength + rawBody.byteLength);
    signedMessage.set(prefix, 0);
    signedMessage.set(rawBody, prefix.byteLength);

    return signedMessage;
  }

  private decodeSignature(
    offered: string,
    encoding: ConnectorCallbackHmacAuth['encoding'],
  ): Buffer | undefined {
    const normalized = offered.trim();
    const pattern = encoding === 'hex' ? HEX_SIGNATURE_PATTERN : BASE64_SIGNATURE_PATTERN;

    if (normalized.length === 0 || !pattern.test(normalized)) {
      return undefined;
    }

    const decoded = Buffer.from(normalized, encoding);

    return decoded.byteLength === 0 ? undefined : decoded;
  }

  private findHeaderValue(
    headers: ConnectorCallbackMappingInput['headers'],
    headerName: string,
  ): string | undefined {
    const normalizedName = headerName.trim().toLowerCase();

    for (const [key, value] of Object.entries(headers)) {
      if (
        key.trim().toLowerCase() === normalizedName &&
        typeof value === 'string' &&
        value.trim().length > 0
      ) {
        return value.trim();
      }
    }

    return undefined;
  }
}
