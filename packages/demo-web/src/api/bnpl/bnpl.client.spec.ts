import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BffError,
  bankLogin,
  createSession,
  getSession,
  submitSession,
  waitForResult,
  type SessionView,
} from './bnpl.client';

const TOKEN = 'tok_123';

function view(overrides: Partial<SessionView>): SessionView {
  return {
    phase: 'processing',
    journey: 'uk-algoan',
    step: null,
    fields: [],
    data: {},
    persona: 'sherlock',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('bnpl client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('requests', () => {
    it('should post the persona when creating a session', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ token: TOKEN, persona: 'sherlock' }, 201));

      const created = await createSession('sherlock');

      expect(created.token).toBe(TOKEN);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:3100/v1/bnpl/sessions');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ persona: 'sherlock' }));
    });

    it('should post an empty body when creating a session without a persona', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ token: TOKEN, persona: null }, 201));

      const created = await createSession();

      expect(created.persona).toBeNull();
      expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({}));
    });

    it('should post the persona and method when logging in to the bank', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(view({ phase: 'collect' })));

      await bankLogin(TOKEN, { persona: 'sherlock', method: 'qr' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`http://localhost:3100/v1/bnpl/sessions/${TOKEN}/bank-login`);
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ persona: 'sherlock', method: 'qr' }));
    });

    it('should pass wait as a query parameter when reading a session', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(view({})));

      await getSession(TOKEN, { wait: 25 });

      expect(fetchMock.mock.calls[0][0]).toBe(
        `http://localhost:3100/v1/bnpl/sessions/${TOKEN}?wait=25`,
      );
    });

    it('should raise a BffError carrying the field errors on INVALID_STEP_DATA', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            statusCode: 400,
            code: 'INVALID_STEP_DATA',
            message: 'bad',
            errors: { email: ['REQUIRED'] },
          },
          400,
        ),
      );

      const failure = await submitSession(TOKEN, {}).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(BffError);
      expect(failure).toMatchObject({
        status: 400,
        code: 'INVALID_STEP_DATA',
        errors: { email: ['REQUIRED'] },
      });
    });
  });

  describe('waitForResult', () => {
    it('should stop on the first result', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(view({ phase: 'result', decision: 'approved' })),
      );

      const outcome = await waitForResult(TOKEN);

      expect(outcome.kind).toBe('result');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('?wait=25');
    });

    it('should keep polling while the session is processing', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(view({ phase: 'processing' })))
        .mockResolvedValueOnce(jsonResponse(view({ phase: 'processing' })))
        .mockResolvedValueOnce(jsonResponse(view({ phase: 'result', decision: 'review' })));

      const outcome = await waitForResult(TOKEN, { perRequestSeconds: 25, totalMs: 180_000 });

      expect(outcome.kind).toBe('result');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should stop when the credit check asks for a retry', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(view({ phase: 'collect', retry: true, attempt: 2 })),
      );

      const outcome = await waitForResult(TOKEN);

      expect(outcome.kind).toBe('retry');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should stop with a timeout once the total budget is spent', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      fetchMock.mockImplementation(async () => {
        vi.advanceTimersByTime(25_000);
        return jsonResponse(view({ phase: 'processing' }));
      });

      const outcome = await waitForResult(TOKEN, { perRequestSeconds: 25, totalMs: 60_000 });

      expect(outcome.kind).toBe('timeout');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should reject when the signal aborts', async () => {
      const controller = new AbortController();
      fetchMock.mockImplementation(async (_url, init) => {
        controller.abort();
        init?.signal?.throwIfAborted();
        return jsonResponse(view({}));
      });

      await expect(waitForResult(TOKEN, { signal: controller.signal })).rejects.toThrow();
    });
  });
});
