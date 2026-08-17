import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';
import {
  AdminTokenVerificationError,
  AdminTokenVerifierUnavailableError,
} from './admin-token-verifier.port';
import { AzureTokenVerifier, buildEntraIssuer, buildEntraJwksUrl } from './azure-token-verifier';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = '22222222-2222-2222-2222-222222222222';
const KEY_ID = 'test-signing-key';

describe('AzureTokenVerifier', () => {
  let privateKey: KeyLike;
  let getKey: JWTVerifyGetKey;
  let verifier: AzureTokenVerifier;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;

    const publicJwk = await exportJWK(keyPair.publicKey);
    getKey = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }] });

    verifier = new AzureTokenVerifier({ tenantId: TENANT_ID, audience: AUDIENCE, getKey });
  });

  async function signToken(
    claims: { issuer?: string; audience?: string; expiresIn?: string } = {},
  ): Promise<string> {
    return new SignJWT({ scp: 'Onboardings.Read' })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject('operator-object-id')
      .setIssuer(claims.issuer ?? buildEntraIssuer(TENANT_ID))
      .setAudience(claims.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? '5m')
      .sign(privateKey);
  }

  it('derives the issuer and JWKS URL from the tenant id', () => {
    expect(buildEntraIssuer(TENANT_ID)).toBe(`https://login.microsoftonline.com/${TENANT_ID}/v2.0`);
    expect(buildEntraJwksUrl(TENANT_ID).toString()).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
    );
  });

  it('accepts a token signed by the tenant for this API', async () => {
    const payload = await verifier.verify(await signToken());

    expect(payload.sub).toBe('operator-object-id');
    expect(payload.aud).toBe(AUDIENCE);
  });

  it('rejects a token issued by a different tenant', async () => {
    const token = await signToken({
      issuer: buildEntraIssuer('99999999-9999-9999-9999-999999999999'),
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AdminTokenVerificationError);
  });

  it('rejects a v1.0 issuer, which Entra emits when accessTokenAcceptedVersion is not 2', async () => {
    const token = await signToken({ issuer: `https://sts.windows.net/${TENANT_ID}/` });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AdminTokenVerificationError);
  });

  it('rejects a token minted for a different audience', async () => {
    const token = await signToken({ audience: 'api://some-other-service' });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AdminTokenVerificationError);
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ expiresIn: '-1m' });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AdminTokenVerificationError);
  });

  it('rejects a token signed by an unknown key', async () => {
    const attackerKeyPair = await generateKeyPair('RS256', { extractable: true });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setIssuer(buildEntraIssuer(TENANT_ID))
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(attackerKeyPair.privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AdminTokenVerificationError);
  });

  it('rejects an unsigned token', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(AdminTokenVerificationError);
  });

  it('rejects an unrecognized signing key as a bad token, not an outage', async () => {
    // A forged `kid` is the ordinary shape of an attack. Reporting it as an outage would let any
    // caller provoke a 503 at will.
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'a-kid-the-tenant-never-published' })
      .setIssuer(buildEntraIssuer(TENANT_ID))
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AdminTokenVerificationError);
  });

  describe('when the signing key set cannot be retrieved', () => {
    async function verifyWithFailingKeySet(failure: unknown): Promise<unknown> {
      const failingVerifier = new AzureTokenVerifier({
        tenantId: TENANT_ID,
        audience: AUDIENCE,
        getKey: () => Promise.reject(failure),
      });

      return failingVerifier.verify(await signToken());
    }

    it.each([
      ['a JWKS fetch timeout', new errors.JWKSTimeout()],
      [
        'a non-200 JWKS response',
        new errors.JOSEError('Expected 200 OK from the JSON Web Key Set'),
      ],
      ['an unusable JWKS body', new errors.JWKSInvalid('JSON Web Key Set malformed')],
      [
        'a refused connection',
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      ],
      ['a DNS failure', Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })],
    ])('reports %s as unavailable rather than as a rejected token', async (_label, failure) => {
      await expect(verifyWithFailingKeySet(failure)).rejects.toBeInstanceOf(
        AdminTokenVerifierUnavailableError,
      );
    });

    it('carries the underlying reason so an operator can see what failed', async () => {
      await expect(verifyWithFailingKeySet(new errors.JWKSTimeout())).rejects.toThrow(/timed out/i);
    });
  });
});
