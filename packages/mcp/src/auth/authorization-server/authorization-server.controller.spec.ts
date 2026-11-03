import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../auth.module';
import { REQUEST_AUTHENTICATOR } from '../request-authenticator';
import { TOKEN_BODY_LIMIT_BYTES } from './token-relay';

const CONFIG = {
  MCP_AUTH_ENABLED: true,
  MCP_PUBLIC_URL: 'https://mcp.example.com/',
  MCP_PORT: 3100,
  MCP_AZURE_TENANT_ID: 'tenant-id',
  MCP_AZURE_CLIENT_ID: 'client-id',
  MCP_PUBLIC_CLIENT_ID: 'public-client',
  MCP_REQUIRED_SCOPE: 'Mcp.Access',
};

const HOST = { Host: 'mcp.example.com' };
const TOKEN_URL = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token';

const ROUTES = [
  ['get', '/.well-known/oauth-authorization-server'],
  ['get', '/.well-known/openid-configuration'],
  ['get', '/oauth/authorize'],
  ['post', '/oauth/token'],
  ['post', '/oauth/register'],
] as const;

const SECRETS = [
  'secret-code-123',
  'secret-verifier-456',
  'secret-refresh-789',
  'secret-access-token',
];

const AUTHORIZE_QUERY = {
  client_id: 'public-client',
  response_type: 'code',
  redirect_uri: 'http://localhost:54321/callback',
  scope: 'api://client-id/Mcp.Access',
  state: 'state-1',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  resource: 'https://mcp.example.com/mcp',
};

const CODE_GRANT = {
  grant_type: 'authorization_code',
  code: SECRETS[0],
  code_verifier: SECRETS[1],
  redirect_uri: 'http://localhost:54321/callback',
  client_id: 'public-client',
  resource: 'https://mcp.example.com/mcp',
};

describe('AuthorizationServerController', () => {
  let app: INestApplication;

  async function startApp(config: Record<string, unknown>): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => config] }),
        AuthModule,
      ],
    })
      .overrideProvider(REQUEST_AUTHENTICATOR)
      .useValue(null)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }

  afterEach(async () => {
    await app.close();
  });

  describe('with authentication on', () => {
    beforeEach(async () => {
      await startApp(CONFIG);
    });

    it.each(['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'])(
      'serves the authorization-server metadata at %s',
      async (path) => {
        const response = await request(app.getHttpServer()).get(path).set(HOST).expect(200);

        expect(response.body).toEqual({
          issuer: 'https://mcp.example.com',
          authorization_endpoint: 'https://mcp.example.com/oauth/authorize',
          token_endpoint: 'https://mcp.example.com/oauth/token',
          registration_endpoint: 'https://mcp.example.com/oauth/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: ['api://client-id/Mcp.Access', 'offline_access'],
        });
      },
    );

    describe('GET /oauth/authorize', () => {
      it('redirects to the tenant without resource and with offline_access', async () => {
        const response = await request(app.getHttpServer())
          .get('/oauth/authorize')
          .query(AUTHORIZE_QUERY)
          .set(HOST)
          .expect(302);

        const location = new URL(response.headers.location);
        expect(`${location.origin}${location.pathname}`).toBe(
          'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize',
        );
        expect(location.searchParams.has('resource')).toBe(false);
        expect(location.searchParams.get('scope')).toBe(
          'api://client-id/Mcp.Access offline_access',
        );
        expect(location.searchParams.get('client_id')).toBe('public-client');
        expect(location.searchParams.get('code_challenge')).toBe('challenge');
      });

      it('refuses a foreign client id with a 400 and no redirect', async () => {
        const response = await request(app.getHttpServer())
          .get('/oauth/authorize')
          .query({ ...AUTHORIZE_QUERY, client_id: 'other-client' })
          .set(HOST)
          .expect(400);

        expect(response.headers.location).toBeUndefined();
        expect(response.body).toMatchObject({ error: 'invalid_client' });
      });

      it('accepts a browser navigation, which sends no Origin', async () => {
        await request(app.getHttpServer())
          .get('/oauth/authorize')
          .query(AUTHORIZE_QUERY)
          .set(HOST)
          .set('Accept', 'text/html')
          .expect(302);
      });
    });

    describe('POST /oauth/token', () => {
      it("returns Entra's status and body, with no-store, after dropping resource", async () => {
        const fetchSpy = jest
          .spyOn(global, 'fetch')
          .mockResolvedValue(
            new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
          );

        const response = await request(app.getHttpServer())
          .post('/oauth/token')
          .type('form')
          .send(CODE_GRANT)
          .set(HOST)
          .expect(400);

        expect(response.body).toEqual({ error: 'invalid_grant' });
        expect(response.headers['cache-control']).toBe('no-store');
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(TOKEN_URL);
        expect(new URLSearchParams(init.body as string).has('resource')).toBe(false);
      });

      it('answers 200 for a successful exchange', async () => {
        jest
          .spyOn(global, 'fetch')
          .mockResolvedValue(
            new Response(JSON.stringify({ access_token: SECRETS[3], token_type: 'Bearer' })),
          );

        const response = await request(app.getHttpServer())
          .post('/oauth/token')
          .type('form')
          .send(CODE_GRANT)
          .set(HOST)
          .expect(200);

        expect(response.body).toEqual({ access_token: SECRETS[3], token_type: 'Bearer' });
      });

      it('refuses an unsupported grant and a foreign client without calling Entra', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch');

        const grant = await request(app.getHttpServer())
          .post('/oauth/token')
          .type('form')
          .send({ ...CODE_GRANT, grant_type: 'client_credentials' })
          .set(HOST)
          .expect(400);
        const client = await request(app.getHttpServer())
          .post('/oauth/token')
          .type('form')
          .send({ ...CODE_GRANT, client_id: 'other-client' })
          .set(HOST)
          .expect(400);

        expect(grant.body).toMatchObject({ error: 'unsupported_grant_type' });
        expect(client.body).toMatchObject({ error: 'invalid_client' });
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('answers 502 with an OAuth-shaped error when Entra cannot be reached', async () => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

        const response = await request(app.getHttpServer())
          .post('/oauth/token')
          .type('form')
          .send(CODE_GRANT)
          .set(HOST)
          .expect(502);

        expect(response.body).toMatchObject({ error: 'temporarily_unavailable' });
      });

      it('refuses a body over the limit without calling Entra', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch');

        await request(app.getHttpServer())
          .post('/oauth/token')
          .type('form')
          .send({ ...CODE_GRANT, code: 'x'.repeat(TOKEN_BODY_LIMIT_BYTES) })
          .set(HOST)
          .expect(413);

        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('logs no body, code, verifier or token, on success or on failure', async () => {
        // The testing module silences `Logger` output, so the calls themselves are what is checked.
        const output: string[] = [];
        for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
          jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
            output.push(JSON.stringify(args));
          });
        }
        jest
          .spyOn(global, 'fetch')
          .mockRejectedValue(new TypeError(`fetch failed for ${SECRETS[0]}`))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ access_token: SECRETS[3], refresh_token: SECRETS[2] })),
          );

        const send = (body: Record<string, string>) =>
          request(app.getHttpServer()).post('/oauth/token').type('form').send(body).set(HOST);
        await send(CODE_GRANT).expect(200);
        await send(CODE_GRANT).expect(502);
        await send({ ...CODE_GRANT, client_id: SECRETS[2] }).expect(400);
        await send({
          grant_type: 'refresh_token',
          refresh_token: SECRETS[2],
          client_id: 'public-client',
        }).expect(502);

        const logged = output.join('');
        expect(logged).toContain('OAUTH_RELAY_REFUSED');
        for (const secret of SECRETS) {
          expect(logged).not.toContain(secret);
        }
      });
    });

    describe('POST /oauth/register', () => {
      it('registers a loopback client with the public client id', async () => {
        const response = await request(app.getHttpServer())
          .post('/oauth/register')
          .send({
            client_name: 'Claude Code',
            redirect_uris: ['http://localhost:54321/callback'],
            token_endpoint_auth_method: 'none',
          })
          .set(HOST)
          .expect(201);

        expect(response.body).toEqual({
          client_id: 'public-client',
          client_id_issued_at: expect.any(Number),
          redirect_uris: ['http://localhost:54321/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        });
      });

      it('refuses a redirect URI that is not loopback', async () => {
        const response = await request(app.getHttpServer())
          .post('/oauth/register')
          .send({ redirect_uris: ['https://evil.example/callback'] })
          .set(HOST)
          .expect(400);

        expect(response.body).toMatchObject({ error: 'invalid_redirect_uri' });
      });
    });

    describe('DNS-rebinding protection', () => {
      it.each(ROUTES)('refuses %s %s for a foreign Host', async (method, path) => {
        await request(app.getHttpServer())[method](path).set('Host', 'evil.example').expect(403);
      });

      it.each(ROUTES)('refuses %s %s for a foreign Origin', async (method, path) => {
        await request(app.getHttpServer())
          [method](path)
          .set(HOST)
          .set('Origin', 'https://evil.example')
          .expect(403);
      });

      it('lets the loopback name on the listen port through', async () => {
        await request(app.getHttpServer())
          .get('/.well-known/oauth-authorization-server')
          .set('Host', 'localhost:3100')
          .expect(200);
      });
    });
  });

  describe('with authentication off', () => {
    beforeEach(async () => {
      await startApp({ ...CONFIG, MCP_AUTH_ENABLED: false });
    });

    it.each(ROUTES)('answers 404 on %s %s', async (method, path) => {
      await request(app.getHttpServer())[method](path).expect(404);
    });
  });

  describe('MCP_PUBLIC_CLIENT_ID', () => {
    it('defaults to MCP_AZURE_CLIENT_ID', async () => {
      await startApp({ ...CONFIG, MCP_PUBLIC_CLIENT_ID: undefined });

      const response = await request(app.getHttpServer())
        .post('/oauth/register')
        .send({ redirect_uris: ['http://localhost/callback'] })
        .set(HOST)
        .expect(201);

      expect(response.body.client_id).toBe('client-id');
    });
  });
});
