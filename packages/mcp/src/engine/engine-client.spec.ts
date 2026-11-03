import { ConfigService } from '@nestjs/config';
import { RequestContext } from '../request-context/request-context';
import { EngineClient } from './engine-client';
import { EngineError } from './engine-error';

const LOCAL: RequestContext = { identity: { kind: 'local' } };
const ANALYST: RequestContext = {
  identity: { kind: 'user', objectId: 'oid-1', upn: 'analyst@example.com' },
  engineToken: 'engine-token-value',
};

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('EngineClient', () => {
  let client: EngineClient;
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;

  beforeEach(() => {
    client = new EngineClient(new ConfigService({ MCP_ENGINE_BASE_URL: 'http://engine:3000/' }));
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[0];
    return { url: String(url), init: init as RequestInit };
  }

  describe('token forwarding', () => {
    it('sends the per-request engine token as a bearer credential', async () => {
      fetchMock.mockResolvedValue(reply(200, { items: [] }));

      await client.request('get', '/v1/onboardings', ANALYST);

      expect(lastCall().init.headers).toMatchObject({ Authorization: 'Bearer engine-token-value' });
    });

    it('sends no credential when the context carries no engine token', async () => {
      fetchMock.mockResolvedValue(reply(200, { items: [] }));

      await client.request('get', '/v1/onboardings', LOCAL);

      expect(lastCall().init.headers).not.toHaveProperty('Authorization');
    });
  });

  describe('request building', () => {
    it('substitutes encoded path parameters and appends only the defined query values', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(reply(200, [])));

      await client.request('get', '/v1/onboardings/{id}/transitions', LOCAL, {
        path: { id: 'a/b c' },
      });
      await client.request('get', '/v1/onboardings', LOCAL, {
        query: { limit: 100, status: undefined, workflowId: 'kyc' },
      });

      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'http://engine:3000/v1/onboardings/a%2Fb%20c/transitions',
      );
      expect(String(fetchMock.mock.calls[1][0])).toBe(
        'http://engine:3000/v1/onboardings?limit=100&workflowId=kyc',
      );
    });

    it('posts a JSON body', async () => {
      fetchMock.mockResolvedValue(reply(200, { ok: true }));
      const document = { id: 'kyc', version: 1, steps: [] };

      await client.request('post', '/v1/admin/workflows/compile', LOCAL, { body: document });

      const { init } = lastCall();
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(init.body).toBe(JSON.stringify(document));
    });

    it('rejects a call that omits a required path parameter or body at compile time', () => {
      // Never executed: only the compiler's verdict on each line matters.
      void (async () => {
        // @ts-expect-error the transitions route needs `path.id`
        await client.request('get', '/v1/onboardings/{id}/transitions', LOCAL);
        // @ts-expect-error the compile route needs a body
        await client.request('post', '/v1/admin/workflows/compile', LOCAL, {});
        // @ts-expect-error the list route is not a POST path with that name
        await client.request('get', '/v1/not-a-route', LOCAL);
      });
    });
  });

  describe('error mapping', () => {
    it.each([
      [401, /401.*sign in again/i],
      [403, /403.*role/i],
      [404, /Not found \(404\): Onboarding missing/],
      [503, /unavailable \(503\): Admin authentication is not configured/],
    ])('turns %i into an error the model can read', async (status, readable) => {
      fetchMock.mockResolvedValue(
        reply(status, {
          statusCode: status,
          message: status === 404 ? 'Onboarding missing' : 'Admin authentication is not configured',
        }),
      );

      const failure = await client.request('get', '/v1/onboardings', ANALYST).catch((e) => e);

      expect(failure).toBeInstanceOf(EngineError);
      expect(failure.status).toBe(status);
      expect(failure.message).toMatch(readable);
      expect(failure.message).not.toContain('engine-token-value');
    });

    it('keeps the code and body of any other refusal for the tool to interpret', async () => {
      const body = { code: 'WORKFLOW_INVALID', message: 'bad step', path: 'steps.0' };
      fetchMock.mockResolvedValue(reply(400, body));

      const failure = await client
        .request('post', '/v1/admin/workflows/compile', LOCAL, {
          body: { id: 'kyc', version: 1, steps: [] },
        })
        .catch((e) => e);

      expect(failure).toMatchObject({ status: 400, code: 'WORKFLOW_INVALID', body });
      expect(failure.message).toBe('The engine answered 400 WORKFLOW_INVALID: bad step');
    });

    it('says the engine could not be reached when fetch itself fails', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const failure = await client.request('get', '/v1/onboardings', LOCAL).catch((e) => e);

      expect(failure).toBeInstanceOf(EngineError);
      expect(failure.status).toBeUndefined();
      expect(failure.message).toMatch(/could not be reached/);
    });
  });

  describe('openStream', () => {
    it('hands back the body as it arrives and maps a refusal like any other call', async () => {
      fetchMock.mockResolvedValueOnce(new Response('id,status\n1,approved\n', { status: 200 }));

      const stream = await client.openStream('/v1/onboardings/export', ANALYST);

      expect(await new Response(stream).text()).toBe('id,status\n1,approved\n');

      fetchMock.mockResolvedValueOnce(reply(403, { statusCode: 403, message: 'Forbidden' }));
      await expect(client.openStream('/v1/onboardings/export', ANALYST)).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
