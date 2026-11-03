import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

const ENVIRONMENT = {
  NODE_ENV: 'test',
  MCP_PUBLIC_URL: 'http://localhost:3100',
  MCP_ENGINE_BASE_URL: 'http://engine:3000',
  MCP_MASKING_KEY: 'k'.repeat(32),
  MCP_AUTH_ENABLED: 'false',
};

// The listen port is the configured one; supertest's own ephemeral port is not an allowed Host.
const JSON_RPC_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  Host: 'localhost:3100',
};

const WRITE_TOOL_NAMES = ['create_workflow_draft', 'reconcile_pending_connector'];
const READ_TOOL_COUNT = 14;
const WRITE_TOOL_COUNT = WRITE_TOOL_NAMES.length;

function buildConfig(settings: Record<string, unknown>): ConfigService {
  return new ConfigService({
    MCP_AUTH_ENABLED: false,
    MCP_PORT: 3100,
    MCP_WRITE_TOOLS_ENABLED: false,
    MCP_ENGINE_BASE_URL: ENVIRONMENT.MCP_ENGINE_BASE_URL,
    MCP_PUBLIC_URL: ENVIRONMENT.MCP_PUBLIC_URL,
    MCP_MASKING_KEY: ENVIRONMENT.MCP_MASKING_KEY,
    MCP_MASKING_PASS_FIELDS: 'country,nationality',
    ...settings,
  });
}

async function startApp(config?: ConfigService): Promise<INestApplication> {
  // `ConfigModule.forRoot` validates the environment when `AppModule` is imported, so it is set
  // first; a spec that needs other settings replaces the `ConfigService` instead.
  Object.assign(process.env, ENVIRONMENT);
  const { AppModule } = await import('../app.module');
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (
    config ? builder.overrideProvider(ConfigService).useValue(config) : builder
  ).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return app;
}

describe('POST /mcp', () => {
  describe('with authentication off', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startApp();
    });

    afterAll(async () => {
      await app.close();
    });

    function rpc(body: object) {
      return request(app.getHttpServer()).post('/mcp').set(JSON_RPC_HEADERS).send(body);
    }

    it('answers initialize with the server info and the tools capability', async () => {
      const response = await rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'spec', version: '0.0.0' },
        },
      }).expect(200);

      expect(response.body.result).toMatchObject({
        serverInfo: { name: 'tsh-onboarding-conductor-mcp' },
        capabilities: { tools: {} },
      });
      expect(response.headers['mcp-session-id']).toBeUndefined();
    });

    it('answers a call to an unknown tool with a JSON-RPC error', async () => {
      const response = await rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'nope', arguments: {} },
      }).expect(200);

      expect(response.body.error.message).toMatch(/Unknown tool: nope/);
    });

    it.each(['get', 'delete'] as const)('answers %s with 405 and an Allow header', async (verb) => {
      const response = await request(app.getHttpServer())[verb]('/mcp').expect(405);

      expect(response.headers.allow).toBe('POST');
    });

    describe('DNS rebinding protection', () => {
      const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

      it.each(['evil.example.com', 'localhost:9999', 'localhost'])(
        'refuses the Host %s',
        async (host) => {
          const response = await rpc(LIST_TOOLS).set('Host', host).expect(403);

          expect(response.body.error.message).toMatch(/Invalid Host header/);
        },
      );

      it.each(['http://evil.example.com', 'https://localhost:3100', 'null'])(
        'refuses the Origin %s',
        async (origin) => {
          const response = await rpc(LIST_TOOLS).set('Origin', origin).expect(403);

          expect(response.body.error.message).toMatch(/Invalid Origin header/);
        },
      );

      it.each(['localhost:3100', '127.0.0.1:3100'])('serves the Host %s', async (host) => {
        await rpc(LIST_TOOLS).set('Host', host).expect(200);
      });

      it.each(['http://localhost:3100', 'http://127.0.0.1:3100'])(
        'serves the Origin %s',
        async (origin) => {
          await rpc(LIST_TOOLS).set('Origin', origin).expect(200);
        },
      );

      it('serves a request with no Origin header, as a non-browser client sends it', async () => {
        const response = await rpc(LIST_TOOLS).unset('Origin').expect(200);

        expect(response.body.result.tools.length).toBeGreaterThan(0);
      });
    });

    it('keeps serving /health', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });

  describe('with authentication on and no bearer token', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startApp(
        buildConfig({
          MCP_AUTH_ENABLED: true,
          MCP_AZURE_TENANT_ID: 'tenant-id',
          MCP_AZURE_CLIENT_ID: 'client-id',
          MCP_AZURE_CLIENT_SECRET: 'client-secret',
          MCP_REQUIRED_SCOPE: 'Mcp.Access',
          MCP_ENGINE_SCOPE: 'api://engine/.default',
        }),
      );
    });

    afterAll(async () => {
      await app.close();
    });

    it('refuses with 401 and the resource metadata challenge rather than serving the caller as local', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set(JSON_RPC_HEADERS)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(401);

      expect(response.headers['www-authenticate']).toContain('resource_metadata=');
    });
  });

  describe.each([
    [false, READ_TOOL_COUNT],
    [true, READ_TOOL_COUNT + WRITE_TOOL_COUNT],
  ])('with the full app and MCP_WRITE_TOOLS_ENABLED=%s', (writeEnabled, expectedCount) => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startApp(buildConfig({ MCP_WRITE_TOOLS_ENABLED: writeEnabled }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('lists every tool, annotating the write tools only when they are exposed', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set(JSON_RPC_HEADERS)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(200);

      const tools: Array<{ name: string; annotations?: object }> = response.body.result.tools;
      const writeTools = tools.filter((tool) => WRITE_TOOL_NAMES.includes(tool.name));

      expect(tools).toHaveLength(expectedCount);
      expect(writeTools.map((tool) => tool.name).sort()).toEqual(
        writeEnabled ? [...WRITE_TOOL_NAMES].sort() : [],
      );
      for (const tool of writeTools) {
        expect(tool.annotations).toEqual({ destructiveHint: true, idempotentHint: false });
      }
      expect(
        tools.filter((tool) => !WRITE_TOOL_NAMES.includes(tool.name) && tool.annotations),
      ).toEqual([]);
    });

    it('declares every tool closed to arguments it does not list', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set(JSON_RPC_HEADERS)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(200);

      const tools: Array<{ name: string; inputSchema: { additionalProperties?: boolean } }> =
        response.body.result.tools;

      expect(
        tools
          .filter((tool) => tool.inputSchema.additionalProperties !== false)
          .map(({ name }) => name),
      ).toEqual([]);
    });

    it('refuses an argument a tool does not list before reading anything', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set(JSON_RPC_HEADERS)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list_workflows', arguments: { workflowId: 'x' } },
        })
        .expect(200);

      expect(response.body.result.isError).toBe(true);
      expect(response.body.result.content[0].text).toMatch(/Unknown argument workflowId/);
    });
  });
});
