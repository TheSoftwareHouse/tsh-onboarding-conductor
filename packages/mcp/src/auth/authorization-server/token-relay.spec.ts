import { OAuthRequestError } from './oauth-error';
import { TOKEN_REQUEST_TIMEOUT_MS, TokenRelay } from './token-relay';

const TOKEN_URL = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token';

const relay = new TokenRelay({
  publicUrl: 'https://mcp.example.com',
  tenantId: 'tenant-id',
  publicClientId: 'public-client',
  resourceScope: 'api://client-id/Mcp.Access',
});

const CODE_GRANT = {
  grant_type: 'authorization_code',
  code: 'auth-code',
  redirect_uri: 'http://localhost:54321/callback',
  code_verifier: 'verifier',
  client_id: 'public-client',
};

function stubEntra(status: number, body: unknown): jest.SpyInstance {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function sentBody(fetchSpy: jest.SpyInstance): Record<string, string> {
  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

  return Object.fromEntries(new URLSearchParams(init.body as string));
}

async function refusal(body: unknown): Promise<OAuthRequestError> {
  try {
    await relay.relay(body);
  } catch (error) {
    return error as OAuthRequestError;
  }
  throw new Error('Expected the request to be refused');
}

describe('TokenRelay', () => {
  it('forwards an authorization-code grant to the tenant token endpoint', async () => {
    const fetchSpy = stubEntra(200, { access_token: 'at' });

    await relay.relay(CODE_GRANT);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(sentBody(fetchSpy)).toEqual(CODE_GRANT);
  });

  it('sends a timeout signal with the request', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    stubEntra(200, {});

    await relay.relay(CODE_GRANT);

    expect(timeout).toHaveBeenCalledWith(TOKEN_REQUEST_TIMEOUT_MS);
  });

  it('drops resource and every field that is not a grant field', async () => {
    const fetchSpy = stubEntra(200, {});

    await relay.relay({
      ...CODE_GRANT,
      resource: 'https://mcp.example.com/mcp',
      client_secret: 'smuggled',
      assertion: 'x',
    });

    expect(sentBody(fetchSpy)).toEqual(CODE_GRANT);
  });

  it('sets the configured scope plus offline_access on a refresh, whatever scope was sent', async () => {
    const fetchSpy = stubEntra(200, {});

    await relay.relay({
      grant_type: 'refresh_token',
      refresh_token: 'rt',
      client_id: 'public-client',
      scope: 'https://graph.microsoft.com/.default',
    });

    expect(sentBody(fetchSpy)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt',
      client_id: 'public-client',
      scope: 'api://client-id/Mcp.Access offline_access',
    });
  });

  it("returns Entra's status and body as they came, errors included", async () => {
    stubEntra(400, { error: 'invalid_grant', error_description: 'AADSTS70008: expired' });

    await expect(relay.relay(CODE_GRANT)).resolves.toEqual({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'AADSTS70008: expired' },
    });
  });

  it.each([
    [
      'an unsupported grant',
      { ...CODE_GRANT, grant_type: 'client_credentials' },
      'unsupported_grant_type',
    ],
    ['no grant', { ...CODE_GRANT, grant_type: undefined }, 'unsupported_grant_type'],
    ['no body', undefined, 'unsupported_grant_type'],
    ['a foreign client id', { ...CODE_GRANT, client_id: 'other-client' }, 'invalid_client'],
    ['no client id', { ...CODE_GRANT, client_id: undefined }, 'invalid_client'],
  ])('refuses %s with a 400 before any outbound call', async (_name, body, error) => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const refused = await refusal(body);

    expect(refused.error).toBe(error);
    expect(refused.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 502 temporarily_unavailable when Entra cannot be reached', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const refused = await refusal(CODE_GRANT);

    expect(refused.error).toBe('temporarily_unavailable');
    expect(refused.status).toBe(502);
  });

  it('answers 502 when Entra answers something that is not JSON', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));

    expect((await refusal(CODE_GRANT)).status).toBe(502);
  });
});
