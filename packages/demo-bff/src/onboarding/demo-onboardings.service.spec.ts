import { loadAppConfig } from '../config/app.config';
import { EngineClient } from '../engine/engine.client';
import { DemoOnboardingsService } from './demo-onboardings.service';

describe('demo onboardings adapter', () => {
  const buildConfig = (overrides: Partial<NodeJS.ProcessEnv> = {}) =>
    loadAppConfig({
      ENGINE_BASE_URL: 'http://engine:3000',
      ENGINE_SERVICE_SECRET: 'top-secret',
      ...overrides,
    } as NodeJS.ProcessEnv);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails when required engine configuration is missing', () => {
    expect(() => loadAppConfig({} as NodeJS.ProcessEnv)).toThrow(/ENGINE_BASE_URL/);
  });

  it('defaults demo workflow id to base when not configured', () => {
    const config = buildConfig({ DEMO_WORKFLOW_ID: undefined });

    expect(config.demoWorkflowId).toBe('base');
  });

  it('uses trimmed configured demo workflow id', () => {
    const config = buildConfig({ DEMO_WORKFLOW_ID: '  kyc-v2  ' });

    expect(config.demoWorkflowId).toBe('kyc-v2');
  });

  it('attaches the engine credential header to outbound calls', async () => {
    const config = buildConfig();

    const client = new EngineClient(config);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ onboardingId: 'abc' }),
      json: async () => ({ onboardingId: 'abc' }),
    } as unknown as Response);

    await client.start({ workflowId: 'base' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://engine:3000/v1/onboardings',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-engine-service-secret': 'top-secret',
        }),
      }),
    );
  });

  it('forwards known engine problem responses unchanged', async () => {
    const config = buildConfig();

    const client = new EngineClient(config);
    const problem = {
      type: '/problems/invalid-step-data',
      title: 'Invalid step data',
      status: 400,
      code: 'INVALID_STEP_DATA',
      fieldErrors: [{ field: 'email', code: 'invalid_format' }],
    };

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/problem+json' },
      text: async () => JSON.stringify(problem),
      json: async () => problem,
    } as unknown as Response);

    const service = new DemoOnboardingsService(client, config);

    await expect(service.start({ workflowKey: 'base' })).rejects.toMatchObject({
      status: 400,
      response: problem,
    });
  });

  it('maps public base workflowKey to configured engine workflowId', async () => {
    const config = buildConfig({ DEMO_WORKFLOW_ID: 'workflow-from-config' });
    const client = new EngineClient(config);

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ onboardingId: 'abc' }),
      json: async () => ({ onboardingId: 'abc' }),
    } as unknown as Response);

    const service = new DemoOnboardingsService(client, config);
    await service.start({ workflowKey: 'base' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://engine:3000/v1/onboardings',
      expect.objectContaining({
        body: JSON.stringify({ workflowId: 'workflow-from-config' }),
      }),
    );
  });

  it('passes through non-base workflowKey as engine workflowId', async () => {
    const config = buildConfig({ DEMO_WORKFLOW_ID: 'workflow-from-config' });
    const client = new EngineClient(config);

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ onboardingId: 'abc' }),
      json: async () => ({ onboardingId: 'abc' }),
    } as unknown as Response);

    const service = new DemoOnboardingsService(client, config);
    await service.start({ workflowKey: 'workflow-explicit' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://engine:3000/v1/onboardings',
      expect.objectContaining({
        body: JSON.stringify({ workflowId: 'workflow-explicit' }),
      }),
    );
  });

  it('redacts unexpected upstream failures into a generic problem response', async () => {
    const config = buildConfig();

    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('socket hang up'));

    const service = new DemoOnboardingsService(new EngineClient(config), config);

    await expect(service.start({ workflowKey: 'base' })).rejects.toMatchObject({
      status: 502,
      response: expect.objectContaining({
        type: '/problems/upstream-unavailable',
        title: 'Upstream service unavailable',
      }),
    });
  });

  it('forwards a 404 engine error response unchanged', async () => {
    const config = buildConfig();

    const notFoundBody = {
      code: 'ONBOARDING_NOT_FOUND',
      message: 'ONBOARDING_NOT_FOUND',
    };

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(notFoundBody),
      json: async () => notFoundBody,
    } as unknown as Response);

    const service = new DemoOnboardingsService(new EngineClient(config), config);

    await expect(service.get('missing-id')).rejects.toMatchObject({
      status: 404,
      response: notFoundBody,
    });
  });

  it('forwards a 409 engine error response unchanged', async () => {
    const config = buildConfig();

    const conflictBody = {
      code: 'ONBOARDING_COMPLETED',
      message: 'ONBOARDING_COMPLETED',
    };

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(conflictBody),
      json: async () => conflictBody,
    } as unknown as Response);

    const service = new DemoOnboardingsService(new EngineClient(config), config);

    await expect(
      service.submit('existing-id', { email: 'person@example.com' }),
    ).rejects.toMatchObject({
      status: 409,
      response: conflictBody,
    });
  });

  it('returns onboarding history using the bare array shape from engine', async () => {
    const config = buildConfig();

    const historyBody = [
      {
        event: 'transitioned',
        appliedStep: 'collect_contact',
        resultingStatus: 'approved',
        resultingCurrentStep: null,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(historyBody),
      json: async () => historyBody,
    } as unknown as Response);

    const service = new DemoOnboardingsService(new EngineClient(config), config);

    await expect(service.getHistory('existing-id')).resolves.toEqual(historyBody);
  });
});
