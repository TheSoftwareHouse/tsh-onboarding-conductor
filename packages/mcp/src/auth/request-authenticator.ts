import type { JWTPayload } from 'jose';
import type { CallerIdentity, RequestContext } from '../request-context/request-context';
import { TokenRejectedError } from './auth.errors';
import type { OnBehalfOfExchanger } from './on-behalf-of';
import type { TokenVerifier } from './token-verifier';

export const REQUEST_AUTHENTICATOR = Symbol('REQUEST_AUTHENTICATOR');

/**
 * Turns a bearer token into what the tools need: who is calling and the engine token to call as
 * them. `oid` is Entra's immutable user id; `sub` is pairwise per application and only a fallback.
 */
export class RequestAuthenticator {
  constructor(
    private readonly verifier: TokenVerifier,
    private readonly exchanger: OnBehalfOfExchanger,
  ) {}

  async authenticate(token: string): Promise<RequestContext> {
    const claims = await this.verifier.verify(token);
    const identity = readIdentity(claims);
    const engineToken = await this.exchanger.exchange(token);

    return { identity, engineToken };
  }
}

function readIdentity(claims: JWTPayload): CallerIdentity {
  const objectId = readString(claims.oid) ?? readString(claims.sub);

  if (!objectId) {
    throw new TokenRejectedError('Token carries no user object id');
  }

  return {
    kind: 'user',
    objectId,
    upn:
      readString(claims.preferred_username) ??
      readString(claims.upn) ??
      readString(claims.email) ??
      '',
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
