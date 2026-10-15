import { createHmac, timingSafeEqual } from 'node:crypto';
import { buildSignedMessage, escapeAlgoanJson, parseSignatureHeader } from './algoan-signature';

const TEST_SECRET = 'test-signing-secret';

/** Captured from the sandbox on 2026-10-15; the original throwaway secret is unknown. */
const REAL_EVENT_PAYLOAD_SLICE =
  '{"customerId":"6ad0b2b6cd3d6a6d53e424b6","analysisId":"6ad0b2b6cd3d6a6d53e424c4"}';
const REAL_EVENT_BODY =
  '{"subscription":{"disableRecovery":true,"target":"https://webhook.site/1c1c6a96-64ef-44b4-a7d5-698a1081951e","subscriberId":"subscriberIdTest","eventName":"analysis_completed","status":"ACTIVE","id":"6ad0b2b665022026a63aa6ed"},"index":1,"payload":{"customerId":"6ad0b2b6cd3d6a6d53e424b6","analysisId":"6ad0b2b6cd3d6a6d53e424c4"},"createdAt":"2026-10-15T11:02:15.312Z","id":"6ad0b2b765022026a63aa6f3"}';

const encode = (text: string) => new TextEncoder().encode(text);

const sign = (message: Uint8Array | string): string =>
  `sha256=${createHmac('sha256', TEST_SECRET).update(message).digest('hex')}`;

/** What the engine's verifier does with the declared recipe. */
const verifies = (rawBody: string, header: string): boolean => {
  const [offered] = parseSignatureHeader(header);
  const expected = createHmac('sha256', TEST_SECRET)
    .update(buildSignedMessage({ rawBody: encode(rawBody), headers: {} }))
    .digest();
  const offeredBytes = Buffer.from(offered, 'hex');

  return offeredBytes.length === expected.length && timingSafeEqual(offeredBytes, expected);
};

describe('algoan-signature', () => {
  describe('the captured real event', () => {
    it('signs exactly the payload bytes Algoan delivered', () => {
      const message = buildSignedMessage({ rawBody: encode(REAL_EVENT_BODY), headers: {} });

      expect(Buffer.from(message).toString('utf8')).toBe(REAL_EVENT_PAYLOAD_SLICE);
      expect(REAL_EVENT_BODY).toContain(REAL_EVENT_PAYLOAD_SLICE);
    });

    it('verifies against a header recomputed with the test secret', () => {
      expect(verifies(REAL_EVENT_BODY, sign(REAL_EVENT_PAYLOAD_SLICE))).toBe(true);
    });

    it('rejects a tampered payload', () => {
      const tampered = REAL_EVENT_BODY.replace('424c4', '424c5');

      expect(verifies(tampered, sign(REAL_EVENT_PAYLOAD_SLICE))).toBe(false);
    });

    it('does not cover the envelope, only the payload', () => {
      const otherEnvelope = REAL_EVENT_BODY.replace('"index":1', '"index":2');

      expect(verifies(otherEnvelope, sign(REAL_EVENT_PAYLOAD_SLICE))).toBe(true);
    });

    it('rejects a wrong secret', () => {
      const header = `sha256=${createHmac('sha256', 'other').update(REAL_EVENT_PAYLOAD_SLICE).digest('hex')}`;

      expect(verifies(REAL_EVENT_BODY, header)).toBe(false);
    });
  });

  describe('escaping', () => {
    const payload = { path: 'a/b', tag: '<b>', rate: '50%', mail: 'x@y', name: 'Zażółć' };

    it('escapes /, <, %, @ and non-ASCII, leaving key order alone', () => {
      expect(escapeAlgoanJson(JSON.stringify(payload))).toBe(
        '{"path":"a\\/b","tag":"\\u003Cb>","rate":"50\\u0025","mail":"x\\u0040y",' +
          '"name":"Za\\u017c\\u00f3\\u0142\\u0107"}',
      );
    });

    it('feeds the escaped form to buildSignedMessage', () => {
      const body = JSON.stringify({ id: 'e', payload });
      const message = Buffer.from(buildSignedMessage({ rawBody: encode(body), headers: {} }));

      expect(message.toString('utf8')).toBe(escapeAlgoanJson(JSON.stringify(payload)));
      expect(message.toString('utf8')).not.toBe(JSON.stringify(payload));
    });

    it('verifies a payload that needs the escaping', () => {
      const body = JSON.stringify({ payload });
      const header = sign(escapeAlgoanJson(JSON.stringify(payload)));

      expect(verifies(body, header)).toBe(true);
      expect(verifies(body, sign(JSON.stringify(payload)))).toBe(false);
    });
  });

  describe('malformed bodies', () => {
    it.each([['not json'], ['[]'], ['{"id":"x"}'], ['null']])(
      'yield an empty message for %s, which no signature matches',
      (body) => {
        expect(buildSignedMessage({ rawBody: encode(body), headers: {} })).toHaveLength(0);
        expect(verifies(body, sign(REAL_EVENT_PAYLOAD_SLICE))).toBe(false);
      },
    );
  });

  describe('parseSignatureHeader', () => {
    it('strips the sha256= prefix', () => {
      expect(parseSignatureHeader('sha256=abc123')).toEqual(['abc123']);
    });

    it('offers a value without the prefix as it came', () => {
      expect(parseSignatureHeader(' abc123 ')).toEqual(['abc123']);
    });
  });
});
