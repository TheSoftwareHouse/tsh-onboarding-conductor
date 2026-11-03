import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  UnsecuredJWT,
  type JWTVerifyGetKey,
} from 'jose';
import { AuthUnavailableError, TokenRejectedError } from './auth.errors';
import { buildEntraIssuer } from './entra';
import { TokenVerifier } from './token-verifier';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = '22222222-2222-2222-2222-222222222222';
const REQUIRED_SCOPE = 'Mcp.Access';
const KEY_ID = 'test-signing-key';

describe('TokenVerifier', () => {
  let privateKey: CryptoKey;
  let getKey: JWTVerifyGetKey;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;

    const publicJwk = await exportJWK(keyPair.publicKey);
    getKey = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }] });
    verifier = new TokenVerifier({
      tenantId: TENANT_ID,
      audience: AUDIENCE,
      requiredScope: REQUIRED_SCOPE,
      getKey,
    });
  });

  async function signToken(
    options: {
      issuer?: string;
      audience?: string;
      expirationTime?: string | number;
      scp?: unknown;
      kid?: string;
    } = {},
  ): Promise<string> {
    return new SignJWT({ scp: 'scp' in options ? options.scp : `openid ${REQUIRED_SCOPE}` })
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KEY_ID })
      .setSubject('subject')
      .setIssuer(options.issuer ?? buildEntraIssuer(TENANT_ID))
      .setAudience(options.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(options.expirationTime ?? '5m')
      .sign(privateKey);
  }

  it('returns the claims of a token for this audience, issuer and scope', async () => {
    const payload = await verifier.verify(await signToken());

    expect(payload.sub).toBe('subject');
  });

  it('rejects the wrong audience', async () => {
    await expect(verifier.verify(await signToken({ audience: 'other-api' }))).rejects.toThrow(
      TokenRejectedError,
    );
  });

  it('rejects the wrong issuer', async () => {
    const token = await signToken({ issuer: buildEntraIssuer('other-tenant') });

    await expect(verifier.verify(token)).rejects.toThrow(TokenRejectedError);
  });

  it('rejects an expired token beyond the clock tolerance', async () => {
    const expiredTenMinutesAgo = Math.floor(Date.now() / 1000) - 600;

    await expect(
      verifier.verify(await signToken({ expirationTime: expiredTenMinutesAgo })),
    ).rejects.toThrow(TokenRejectedError);
  });

  it('accepts a token that expired a few seconds ago, within the clock tolerance', async () => {
    const expiredTenSecondsAgo = Math.floor(Date.now() / 1000) - 10;

    await expect(
      verifier.verify(await signToken({ expirationTime: expiredTenSecondsAgo })),
    ).resolves.toBeDefined();
  });

  it.each([
    ['another scope', 'openid Other.Scope'],
    ['no scp claim', undefined],
    ['a non-string scp claim', [REQUIRED_SCOPE]],
    ['a scope that only contains the required one', `x${REQUIRED_SCOPE}`],
  ])('rejects a token with %s', async (_name, scp) => {
    await expect(verifier.verify(await signToken({ scp }))).rejects.toThrow(TokenRejectedError);
  });

  it('rejects an unsecured alg=none token', async () => {
    const token = new UnsecuredJWT({ scp: REQUIRED_SCOPE })
      .setIssuer(buildEntraIssuer(TENANT_ID))
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .encode();

    await expect(verifier.verify(token)).rejects.toThrow(TokenRejectedError);
  });

  it('rejects an unknown signing key as a bad token, not an outage', async () => {
    await expect(verifier.verify(await signToken({ kid: 'forged-kid' }))).rejects.toThrow(
      TokenRejectedError,
    );
  });

  it('reports an unreachable key set as unavailable, not as a rejected token', async () => {
    const unreachable = new TokenVerifier({
      tenantId: TENANT_ID,
      audience: AUDIENCE,
      requiredScope: REQUIRED_SCOPE,
      getKey: () => Promise.reject(new errors.JWKSTimeout()),
    });

    await expect(unreachable.verify(await signToken())).rejects.toThrow(AuthUnavailableError);
  });

  it('reports a refused connection to the key set as unavailable', async () => {
    const refused = new TokenVerifier({
      tenantId: TENANT_ID,
      audience: AUDIENCE,
      requiredScope: REQUIRED_SCOPE,
      getKey: () => Promise.reject(new TypeError('fetch failed')),
    });

    await expect(refused.verify(await signToken())).rejects.toThrow(AuthUnavailableError);
  });
});
