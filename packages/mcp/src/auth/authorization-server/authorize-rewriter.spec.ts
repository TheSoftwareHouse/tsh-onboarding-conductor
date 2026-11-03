import { AuthorizeRewriter } from './authorize-rewriter';
import { OAuthRequestError } from './oauth-error';

const rewriter = new AuthorizeRewriter({
  publicUrl: 'https://mcp.example.com',
  tenantId: 'tenant-id',
  publicClientId: 'public-client',
  resourceScope: 'api://client-id/Mcp.Access',
});

const VALID_QUERY = {
  client_id: 'public-client',
  response_type: 'code',
  redirect_uri: 'http://localhost:54321/callback',
  scope: 'api://client-id/Mcp.Access',
  state: 'state-1',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
};

function refusal(query: unknown): OAuthRequestError {
  try {
    rewriter.buildRedirectUrl(query);
  } catch (error) {
    return error as OAuthRequestError;
  }
  throw new Error('Expected the request to be refused');
}

describe('AuthorizeRewriter', () => {
  it('redirects to the tenant authorize endpoint, a fixed host', () => {
    const url = new URL(rewriter.buildRedirectUrl(VALID_QUERY));

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize',
    );
  });

  it('forwards the listed parameters, and appends offline_access to the scope', () => {
    const { searchParams } = new URL(
      rewriter.buildRedirectUrl({
        ...VALID_QUERY,
        prompt: 'login',
        login_hint: 'ada@example.com',
        nonce: 'n-1',
      }),
    );

    expect(Object.fromEntries(searchParams)).toEqual({
      ...VALID_QUERY,
      scope: 'api://client-id/Mcp.Access offline_access',
      prompt: 'login',
      login_hint: 'ada@example.com',
      nonce: 'n-1',
    });
  });

  it("asks for this server's own scope when the client sends none", () => {
    const withoutScope: Partial<typeof VALID_QUERY> = { ...VALID_QUERY };
    delete withoutScope.scope;
    const { searchParams } = new URL(rewriter.buildRedirectUrl(withoutScope));

    expect(searchParams.get('scope')).toBe('api://client-id/Mcp.Access offline_access');
  });

  it('keeps an offline_access the client already asked for, once', () => {
    const { searchParams } = new URL(
      rewriter.buildRedirectUrl({
        ...VALID_QUERY,
        scope: 'offline_access api://client-id/Mcp.Access',
      }),
    );

    expect(searchParams.get('scope')).toBe('offline_access api://client-id/Mcp.Access');
  });

  it('drops resource and every parameter it does not know', () => {
    const { searchParams } = new URL(
      rewriter.buildRedirectUrl({
        ...VALID_QUERY,
        resource: 'https://mcp.example.com/mcp',
        response_mode: 'form_post',
        domain_hint: 'evil.example',
        unknown: 'x',
      }),
    );

    expect([...searchParams.keys()].sort()).toEqual(Object.keys(VALID_QUERY).sort());
  });

  it('drops a repeated parameter instead of choosing one of its values', () => {
    expect(refusal({ ...VALID_QUERY, client_id: ['public-client', 'other'] }).error).toBe(
      'invalid_client',
    );
  });

  it.each([
    ['a foreign client_id', { ...VALID_QUERY, client_id: 'other-client' }, 'invalid_client'],
    ['no client_id', { ...VALID_QUERY, client_id: undefined }, 'invalid_client'],
    [
      'a response_type other than code',
      { ...VALID_QUERY, response_type: 'token' },
      'unsupported_response_type',
    ],
    ['a plain PKCE method', { ...VALID_QUERY, code_challenge_method: 'plain' }, 'invalid_request'],
    ['no PKCE', { ...VALID_QUERY, code_challenge_method: undefined }, 'invalid_request'],
  ])('refuses %s with a 400 and no redirect', (_name, query, error) => {
    const refused = refusal(query);

    expect(refused.error).toBe(error);
    expect(refused.status).toBe(400);
  });

  it('refuses a request with no query at all', () => {
    expect(refusal(undefined).error).toBe('invalid_client');
  });
});
