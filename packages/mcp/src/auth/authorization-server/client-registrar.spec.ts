import { ClientRegistrar } from './client-registrar';
import { OAuthRequestError } from './oauth-error';

const NOW_MS = Date.UTC(2026, 10, 2);
const registrar = new ClientRegistrar('public-client', () => NOW_MS);

function refusal(metadata: unknown): OAuthRequestError {
  try {
    registrar.register(metadata);
  } catch (error) {
    return error as OAuthRequestError;
  }
  throw new Error('Expected the registration to be refused');
}

describe('ClientRegistrar', () => {
  it('answers with the configured public client id and echoes the redirect URIs', () => {
    expect(
      registrar.register({
        client_name: 'Claude Code',
        redirect_uris: ['http://localhost:54321/callback', 'http://127.0.0.1/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    ).toEqual({
      client_id: 'public-client',
      client_id_issued_at: NOW_MS / 1000,
      redirect_uris: ['http://localhost:54321/callback', 'http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('defaults what the client leaves out', () => {
    expect(registrar.register({ redirect_uris: ['http://localhost/callback'] })).toMatchObject({
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  it.each([
    ['an https URL', ['https://localhost/callback']],
    ['a foreign host', ['http://example.com/callback']],
    ['a host that only starts with localhost', ['http://localhost.evil.example/callback']],
    ['a loopback name in the userinfo', ['http://localhost@evil.example/callback']],
    ['a custom scheme', ['claude://callback']],
    ['text that is not a URL', ['not a url']],
    ['one foreign URI among loopback ones', ['http://localhost/callback', 'http://example.com/cb']],
    ['no URIs', []],
    ['redirect_uris that is not a list', 'http://localhost/callback'],
    ['no redirect_uris', undefined],
  ])('refuses %s with invalid_redirect_uri', (_name, redirectUris) => {
    const refused = refusal({ redirect_uris: redirectUris });

    expect(refused.error).toBe('invalid_redirect_uri');
    expect(refused.status).toBe(400);
  });

  it.each([
    ['a body that is not an object', 'redirect_uris'],
    ['no body', undefined],
    ['null', null],
  ])('refuses %s with invalid_client_metadata', (_name, body) => {
    expect(refusal(body).error).toBe('invalid_client_metadata');
  });

  it.each([
    ['a client secret method', { token_endpoint_auth_method: 'client_secret_basic' }],
    ['an unsupported grant', { grant_types: ['client_credentials'] }],
    ['an unsupported response type', { response_types: ['token'] }],
    ['grant types that are not a list of strings', { grant_types: [1] }],
  ])('refuses %s with invalid_client_metadata', (_name, extra) => {
    expect(refusal({ redirect_uris: ['http://localhost/callback'], ...extra }).error).toBe(
      'invalid_client_metadata',
    );
  });
});
