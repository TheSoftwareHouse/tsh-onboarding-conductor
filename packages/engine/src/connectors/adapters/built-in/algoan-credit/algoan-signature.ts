import type { ConnectorCallbackSignedMessageInput } from '../../../ports/connector-adapter.port';
import { ALGOAN_SIGNATURE_PREFIX } from './algoan-config';

const HEX_RADIX = 16;
const UNICODE_ESCAPE_DIGITS = 4;

const toUnicodeEscape = (character: string): string =>
  `\\u${character.charCodeAt(0).toString(HEX_RADIX).padStart(UNICODE_ESCAPE_DIGITS, '0')}`;

/**
 * Algoan's "raw escaped Unicode" serialisation, which its signature covers: non-ASCII as
 * `\uXXXX` (lower-case hex), plus `/`, `<`, `%` and `@`. `JSON.stringify` escapes none of the
 * five, so the output differs from it only for a payload carrying one of them.
 */
export const escapeAlgoanJson = (json: string): string =>
  json
    .replace(/[\u0080-\uffff]/g, toUnicodeEscape)
    .replace(/\//g, '\\/')
    .replace(/</g, '\\u003C')
    .replace(/%/g, '\\u0025')
    .replace(/@/g, '\\u0040');

/** `sha256=<hex>` → `<hex>`; a value without the prefix is offered as it came. */
export const parseSignatureHeader = (headerValue: string): readonly string[] => {
  const value = headerValue.trim();

  return [
    value.startsWith(ALGOAN_SIGNATURE_PREFIX) ? value.slice(ALGOAN_SIGNATURE_PREFIX.length) : value,
  ];
};

/**
 * Algoan signs `body.payload` only, re-serialised and escaped; `JSON.parse` keeps key order, so
 * the bytes match what Algoan signed. A body that is not an object carrying a `payload` yields an
 * empty message, which no signature matches, so the engine answers 401 instead of 500.
 */
export const buildSignedMessage = (input: ConnectorCallbackSignedMessageInput): Uint8Array => {
  try {
    const body: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody),
    );
    const payload =
      typeof body === 'object' && body !== null ? Reflect.get(body, 'payload') : undefined;

    return payload === undefined
      ? new Uint8Array()
      : new TextEncoder().encode(escapeAlgoanJson(JSON.stringify(payload)));
  } catch {
    return new Uint8Array();
  }
};
