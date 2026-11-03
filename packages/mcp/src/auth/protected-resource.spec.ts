import { Controller, INestApplication, Post, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { McpRequest } from '../request-context/request-context';
import { AuthModule } from './auth.module';
import { AuthUnavailableError, TokenRejectedError } from './auth.errors';
import { REQUEST_AUTHENTICATOR, type RequestAuthenticator } from './request-authenticator';

const AUTH_CONFIG = {
  MCP_AUTH_ENABLED: true,
  MCP_PUBLIC_URL: 'https://mcp.example.com/',
  MCP_PORT: 3100,
  MCP_AZURE_TENANT_ID: 'tenant-id',
  MCP_AZURE_CLIENT_ID: 'client-id',
  MCP_REQUIRED_SCOPE: 'Mcp.Access',
};

const METADATA_URL = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp';

/** Stands in for the transport: shows what authentication left on the request. */
@Controller('mcp')
class ContextEchoController {
  @Post()
  echo(@Req() req: McpRequest): { context: McpRequest['mcpContext'] | null } {
    return { context: req.mcpContext ?? null };
  }
}

describe('AuthModule', () => {
  const authenticate = jest.fn<ReturnType<RequestAuthenticator['authenticate']>, [string]>();
  let app: INestApplication;

  async function startApp(config: Record<string, unknown>): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => config] }),
        AuthModule,
      ],
      controllers: [ContextEchoController],
    })
      .overrideProvider(REQUEST_AUTHENTICATOR)
      .useValue(config.MCP_AUTH_ENABLED ? { authenticate } : null)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }

  afterEach(async () => {
    await app.close();
  });

  describe('with authentication on', () => {
    beforeEach(async () => {
      await startApp(AUTH_CONFIG);
    });

    it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
      'serves the protected-resource metadata at %s',
      async (path) => {
        const response = await request(app.getHttpServer()).get(path).expect(200);

        expect(response.body).toEqual({
          resource: 'https://mcp.example.com/mcp',
          authorization_servers: ['https://mcp.example.com'],
          scopes_supported: ['api://client-id/Mcp.Access'],
        });
      },
    );

    it('answers 401 with the resource_metadata challenge when no token is sent', async () => {
      const response = await request(app.getHttpServer()).post('/mcp').expect(401);

      expect(response.headers['www-authenticate']).toBe(
        `Bearer resource_metadata="${METADATA_URL}"`,
      );
      expect(authenticate).not.toHaveBeenCalled();
    });

    it('answers 401 with the same challenge for a token that is not a bearer token', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', 'Basic abc')
        .expect(401);

      expect(response.headers['www-authenticate']).toBe(
        `Bearer resource_metadata="${METADATA_URL}"`,
      );
    });

    it('answers 401 with the challenge for a rejected token', async () => {
      authenticate.mockRejectedValue(new TokenRejectedError('expired'));

      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', 'Bearer bad-token')
        .expect(401);

      expect(response.headers['www-authenticate']).toBe(
        `Bearer resource_metadata="${METADATA_URL}"`,
      );
    });

    it('answers 503, not 401, when Entra cannot be reached', async () => {
      authenticate.mockRejectedValue(new AuthUnavailableError('JWKS timeout'));

      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', 'Bearer any-token')
        .expect(503);

      expect(response.headers['www-authenticate']).toBeUndefined();
    });

    it('attaches the verified identity and engine token to the request', async () => {
      const context = {
        identity: { kind: 'user', objectId: 'oid-1', upn: 'ada@example.com' },
        engineToken: 'engine-token',
      } as const;
      authenticate.mockResolvedValue(context);

      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', 'Bearer good-token')
        .expect(201);

      expect(authenticate).toHaveBeenCalledWith('good-token');
      expect(response.body).toEqual({ context });
    });
  });

  describe('with authentication off', () => {
    beforeEach(async () => {
      await startApp({ ...AUTH_CONFIG, MCP_AUTH_ENABLED: false });
    });

    it('lets the request through without a token and without a context', async () => {
      const response = await request(app.getHttpServer()).post('/mcp').expect(201);

      expect(response.body).toEqual({ context: null });
    });

    it('serves no metadata, because there is no authorization server to name', async () => {
      await request(app.getHttpServer()).get('/.well-known/oauth-protected-resource').expect(404);
    });
  });
});
