import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';
import type {
  ConnectorCallbackAuth,
  ConnectorCallbackHmacAuth,
} from '../../connectors/ports/connector-adapter.port';
import { CallbackSignatureInvalidException } from '../errors/callback-signature-invalid.exception';
import { CallbackSignatureVerifier } from './callback-signature.verifier';

describe('CallbackSignatureVerifier', () => {
  const CONNECTOR_ID = 'acme_kyc';
  const SECRET = 'current-signing-value';
  const NOW_SECONDS = 1_800_000_000;
  const rawBody = new TextEncoder().encode('{"providerReference":"ref-1"}');

  const hmacAuth = (
    overrides: Partial<ConnectorCallbackHmacAuth> = {},
  ): ConnectorCallbackHmacAuth => ({
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: 'x-acme-signature',
    encoding: 'hex',
    ...overrides,
  });

  const createVerifier = (
    secrets: Record<string, string | readonly string[]> = { [CONNECTOR_ID]: SECRET },
    nodeEnv = 'test',
    unsignedTypes = '',
  ) => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CONNECTOR_CALLBACK_SIGNING_SECRETS') {
          return JSON.stringify(secrets);
        }

        if (key === 'CONNECTOR_CALLBACK_UNSIGNED_TYPES') {
          return unsignedTypes;
        }

        if (key === 'NODE_ENV') {
          return nodeEnv;
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService<AppConfig, true>;

    return new CallbackSignatureVerifier(configService);
  };

  const sign = (
    message: Uint8Array,
    options: { algorithm?: 'sha256' | 'sha512'; encoding?: 'base64' | 'hex'; secret?: string } = {},
  ): string =>
    createHmac(options.algorithm ?? 'sha256', options.secret ?? SECRET)
      .update(message)
      .digest(options.encoding ?? 'hex');

  const timestampedMessage = (timestamp: number): Uint8Array => {
    const prefix = new TextEncoder().encode(`${timestamp}.`);
    const message = new Uint8Array(prefix.byteLength + rawBody.byteLength);
    message.set(prefix, 0);
    message.set(rawBody, prefix.byteLength);

    return message;
  };

  type VerifyOptions = {
    secrets?: Record<string, string | readonly string[]>;
    nodeEnv?: string;
    unsignedTypes?: string;
  };

  const verifyWith = (
    callbackAuth: ConnectorCallbackAuth | undefined,
    headers: Record<string, string | undefined>,
    options: VerifyOptions = {},
  ) =>
    createVerifier(options.secrets, options.nodeEnv, options.unsignedTypes).verify(
      { id: CONNECTOR_ID, callbackAuth },
      { rawBody, headers },
    );

  const expectRejection = (
    callbackAuth: ConnectorCallbackAuth | undefined,
    headers: Record<string, string | undefined>,
    reason: string,
    options: VerifyOptions = {},
  ) => {
    try {
      verifyWith(callbackAuth, headers, options);
    } catch (error) {
      expect(error).toBeInstanceOf(CallbackSignatureInvalidException);
      expect((error as CallbackSignatureInvalidException).reason).toBe(reason);
      return;
    }

    throw new Error(`Expected rejection with reason=${reason}`);
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('verifies a hex sha256 signature over the raw body', () => {
    expect(verifyWith(hmacAuth(), { 'x-acme-signature': sign(rawBody) })).toBe('verified');
  });

  it('verifies a base64 sha512 signature', () => {
    const auth = hmacAuth({ algorithm: 'sha512', encoding: 'base64' });

    expect(
      verifyWith(auth, {
        'x-acme-signature': sign(rawBody, { algorithm: 'sha512', encoding: 'base64' }),
      }),
    ).toBe('verified');
  });

  it('looks the signature header up case-insensitively', () => {
    expect(verifyWith(hmacAuth(), { 'X-Acme-Signature': sign(rawBody) })).toBe('verified');
  });

  it('accepts a signature produced by any secret in a rotation list', () => {
    expect(
      verifyWith(
        hmacAuth(),
        { 'x-acme-signature': sign(rawBody, { secret: 'previous-signing-value' }) },
        { secrets: { [CONNECTOR_ID]: ['current-signing-value', 'previous-signing-value'] } },
      ),
    ).toBe('verified');
  });

  it('accepts one matching value among several offered signatures', () => {
    const auth = hmacAuth({
      parseSignatureHeader: (headerValue) =>
        headerValue
          .split(',')
          .filter((part) => part.startsWith('v1='))
          .map((part) => part.slice('v1='.length)),
    });

    expect(
      verifyWith(auth, {
        'x-acme-signature': `t=${NOW_SECONDS},v1=${sign(rawBody, { secret: 'stale' })},v1=${sign(rawBody)}`,
      }),
    ).toBe('verified');
  });

  it('uses an adapter-supplied signed message when declared', () => {
    const auth = hmacAuth({
      buildSignedMessage: ({ headers }) => new TextEncoder().encode(headers['x-acme-nonce'] ?? ''),
    });

    expect(
      verifyWith(auth, {
        'x-acme-nonce': 'nonce-1',
        'x-acme-signature': sign(new TextEncoder().encode('nonce-1')),
      }),
    ).toBe('verified');
  });

  describe('timestamped signatures', () => {
    const auth = hmacAuth({ timestamp: { header: 'x-acme-timestamp', toleranceSeconds: 300 } });

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW_SECONDS * 1000);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('signs over "<timestamp>.<rawBody>" by default', () => {
      expect(
        verifyWith(auth, {
          'x-acme-timestamp': String(NOW_SECONDS),
          'x-acme-signature': sign(timestampedMessage(NOW_SECONDS)),
        }),
      ).toBe('verified');
    });

    it('accepts the tolerance boundary in the past and the future', () => {
      for (const timestamp of [NOW_SECONDS - 300, NOW_SECONDS + 300]) {
        expect(
          verifyWith(auth, {
            'x-acme-timestamp': String(timestamp),
            'x-acme-signature': sign(timestampedMessage(timestamp)),
          }),
        ).toBe('verified');
      }
    });

    it('rejects a timestamp just outside the tolerance in either direction', () => {
      for (const timestamp of [NOW_SECONDS - 301, NOW_SECONDS + 301]) {
        expectRejection(
          auth,
          {
            'x-acme-timestamp': String(timestamp),
            'x-acme-signature': sign(timestampedMessage(timestamp)),
          },
          'timestamp_out_of_tolerance',
        );
      }
    });

    it('rejects a missing or non-numeric timestamp header', () => {
      expectRejection(
        auth,
        { 'x-acme-signature': sign(timestampedMessage(NOW_SECONDS)) },
        'timestamp_header_missing',
      );
      expectRejection(
        auth,
        {
          'x-acme-timestamp': '2026-08-18T00:00:00Z',
          'x-acme-signature': sign(timestampedMessage(NOW_SECONDS)),
        },
        'timestamp_header_missing',
      );
    });

    it('rejects a signature that ignores the timestamp prefix', () => {
      expectRejection(
        auth,
        {
          'x-acme-timestamp': String(NOW_SECONDS),
          'x-acme-signature': sign(rawBody),
        },
        'signature_mismatch',
      );
    });
  });

  it('fails closed when the adapter declares no callback auth', () => {
    expectRejection(undefined, { 'x-acme-signature': sign(rawBody) }, 'callback_auth_not_declared');
  });

  describe('connectors whose provider does not sign', () => {
    const unsignedAuth: ConnectorCallbackAuth = {
      kind: 'none',
      justification: 'Provider offers no callback signing',
    };

    it('skips verification outside production without any opt-in', () => {
      expect(verifyWith(unsignedAuth, {})).toBe('skipped_unsigned_connector');
    });

    it('accepts an unsigned callback in production when the connector type is opted in', () => {
      expect(
        verifyWith(
          unsignedAuth,
          {},
          { nodeEnv: 'production', unsignedTypes: `other,${CONNECTOR_ID}` },
        ),
      ).toBe('skipped_unsigned_connector');
    });

    it('refuses an unsigned callback in production when the connector type is not opted in', () => {
      expectRejection(unsignedAuth, {}, 'unsigned_connector_not_allowed', {
        nodeEnv: 'production',
      });
      expectRejection(unsignedAuth, {}, 'unsigned_connector_not_allowed', {
        nodeEnv: 'production',
        unsignedTypes: 'some_other_connector',
      });
    });
  });

  it('rejects when no secret is configured for the connector type', () => {
    expectRejection(hmacAuth(), { 'x-acme-signature': sign(rawBody) }, 'signing_secret_missing', {
      secrets: { other_connector: SECRET },
    });
  });

  it('rejects a missing or blank signature header', () => {
    expectRejection(hmacAuth(), {}, 'signature_header_missing');
    expectRejection(hmacAuth(), { 'x-acme-signature': '   ' }, 'signature_header_missing');
  });

  it('rejects a signature that is malformed for the declared encoding', () => {
    expectRejection(hmacAuth(), { 'x-acme-signature': 'sha256=zzzz' }, 'signature_malformed');
    expectRejection(
      hmacAuth(),
      { 'x-acme-signature': sign(rawBody).slice(0, 63) },
      'signature_malformed',
    );
  });

  it('rejects a signature produced by an unknown secret', () => {
    expectRejection(
      hmacAuth(),
      { 'x-acme-signature': sign(rawBody, { secret: 'attacker-value' }) },
      'signature_mismatch',
    );
  });

  it('rejects a previously valid signature after a single body byte changes', () => {
    const signature = sign(rawBody);
    const tamperedBody = new TextEncoder().encode('{"providerReference":"ref-2"}');
    const verifier = createVerifier();

    expect(() =>
      verifier.verify(
        { id: CONNECTOR_ID, callbackAuth: hmacAuth() },
        { rawBody: tamperedBody, headers: { 'x-acme-signature': signature } },
      ),
    ).toThrow(CallbackSignatureInvalidException);
  });

  it('keeps the client-facing response opaque', () => {
    try {
      verifyWith(hmacAuth(), { 'x-acme-signature': sign(rawBody, { secret: 'attacker-value' }) });
      throw new Error('Expected a rejection');
    } catch (error) {
      const exception = error as CallbackSignatureInvalidException;

      expect(exception.getStatus()).toBe(401);
      expect(exception.getResponse()).toEqual({
        code: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
        message: 'ASYNC_CALLBACK_SIGNATURE_INVALID',
      });
    }
  });
});
