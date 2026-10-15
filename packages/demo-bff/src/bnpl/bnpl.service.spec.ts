import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineError } from '../engine/engine-error';
import { EngineClient, OnboardingState, StateField } from '../engine/engine.client';
import { PersonaNotFoundError, PersonaService } from '../personas/persona.service';
import { BankDataPusher } from './bank-data-pusher';
import { BnplService, ENGINE_ERROR_MAP } from './bnpl.service';
import { BnplSessionStore } from './bnpl-session.store';
import { StateWaiter } from './state-waiter';

const field = (name: string, active = true): StateField => ({
  name,
  type: 'text',
  required: true,
  active,
  value: null,
});

function state(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    onboardingId: 'o1',
    workflowId: 'wf',
    workflowVersion: 1,
    status: 'awaiting_user',
    currentStep: 'applicant',
    terminal: false,
    rejectionReason: null,
    step: {
      name: 'applicant',
      status: 'awaiting_user',
      canSubmit: true,
      schema: {},
      fields: [field('firstName'), field('hidden', false)],
    },
    pending: null,
    data: {},
    ...overrides,
  };
}

describe('BnplService', () => {
  let engine: { startOnboarding: jest.Mock; getState: jest.Mock; submit: jest.Mock };
  let personas: { accounts: jest.Mock };
  let pusher: { push: jest.Mock };
  let store: BnplSessionStore;
  let service: BnplService;
  let token: string;

  beforeEach(async () => {
    engine = { startOnboarding: jest.fn(), getState: jest.fn(), submit: jest.fn() };
    personas = { accounts: jest.fn().mockReturnValue([{ id: 'a1' }]) };
    pusher = { push: jest.fn().mockResolvedValue(undefined) };
    store = new BnplSessionStore();
    service = new BnplService(
      { get: () => 'wf' } as unknown as ConfigService<AppConfig, true>,
      engine as unknown as EngineClient,
      store,
      new StateWaiter(),
      personas as unknown as PersonaService,
      pusher as unknown as BankDataPusher,
    );
    engine.startOnboarding.mockResolvedValue({ onboardingId: 'o1' });
    ({ token } = await service.createSession('sherlock_holmes'));
  });

  describe('createSession', () => {
    it('starts the configured workflow and binds the token to the onboarding', async () => {
      expect(engine.startOnboarding).toHaveBeenCalledWith('wf');
      expect(store.get(token)).toMatchObject({ onboardingId: 'o1', persona: 'sherlock_holmes' });
    });

    it('rejects an unknown persona with UNKNOWN_PERSONA before starting anything', async () => {
      engine.startOnboarding.mockClear();
      personas.accounts.mockImplementation(() => {
        throw new PersonaNotFoundError('nobody');
      });

      await expect(service.createSession('nobody')).rejects.toMatchObject({
        response: { code: 'UNKNOWN_PERSONA' },
      });
      expect(engine.startOnboarding).not.toHaveBeenCalled();
    });
  });

  describe('getSession phase mapping', () => {
    it('maps an open step to collect with its active fields only', async () => {
      engine.getState.mockResolvedValue(state());

      await expect(service.getSession(token)).resolves.toEqual({
        phase: 'collect',
        step: 'applicant',
        fields: [{ name: 'firstName', type: 'text', required: true, value: null }],
        data: {},
        persona: 'sherlock_holmes',
        accounts: [{ id: 'a1' }],
      });
    });

    it('maps a parked connector to processing', async () => {
      engine.getState.mockResolvedValue(
        state({ pending: { connectorId: 'algoan_credit', parkedAt: null } }),
      );

      await expect(service.getSession(token)).resolves.toMatchObject({
        phase: 'processing',
        fields: [],
      });
    });

    it('maps a terminal onboarding with data to a result and its decision', async () => {
      engine.getState.mockResolvedValue(
        state({
          terminal: true,
          status: 'approved',
          step: null,
          data: { creditOutcome: 'approved', creditScore: 965 },
        }),
      );

      await expect(service.getSession(token)).resolves.toMatchObject({
        phase: 'result',
        decision: 'approved',
        step: null,
        data: { creditScore: 965 },
      });
    });

    it('maps a review outcome that is not terminal yet to a review result', async () => {
      engine.getState.mockResolvedValue(
        state({ data: { creditOutcome: 'review' }, status: 'awaiting_manual_review' }),
      );

      await expect(service.getSession(token)).resolves.toMatchObject({
        phase: 'result',
        decision: 'review',
      });
    });

    it('maps a declined outcome to a declined result', async () => {
      engine.getState.mockResolvedValue(
        state({
          terminal: true,
          status: 'rejected',
          step: null,
          data: { creditOutcome: 'declined' },
        }),
      );

      await expect(service.getSession(token)).resolves.toMatchObject({ decision: 'declined' });
    });

    it('lets the final onboarding status override a review outcome', async () => {
      engine.getState.mockResolvedValue(
        state({
          terminal: true,
          status: 'approved',
          step: null,
          data: { creditOutcome: 'review' },
        }),
      );

      await expect(service.getSession(token)).resolves.toMatchObject({ decision: 'approved' });
    });

    it('maps a retry outcome back to collect with the retry flag and attempt', async () => {
      engine.getState.mockResolvedValue(
        state({
          currentStep: 'credit_consent',
          data: { creditOutcome: 'retry', creditAttemptCount: 2 },
        }),
      );

      await expect(service.getSession(token)).resolves.toMatchObject({
        phase: 'collect',
        retry: true,
        attempt: 2,
      });
    });

    it('omits the attempt when the engine did not record one', async () => {
      engine.getState.mockResolvedValue(state({ data: { creditOutcome: 'retry' } }));

      const view = await service.getSession(token);

      expect(view).toMatchObject({ phase: 'collect', retry: true });
      expect(view).not.toHaveProperty('attempt');
    });
  });

  describe('getSession long-poll', () => {
    it('keeps re-reading while processing and returns once the phase changes', async () => {
      const parked = state({ pending: { connectorId: 'c', parkedAt: null } });
      const done = state({
        terminal: true,
        status: 'approved',
        step: null,
        data: { creditOutcome: 'approved' },
      });
      engine.getState.mockResolvedValueOnce(parked).mockResolvedValue(done);
      const waiter = (service as unknown as { waiter: StateWaiter }).waiter;
      const started = jest.spyOn(waiter, 'waitFor');

      const pending = service.getSession(token, 5);
      await new Promise((resolve) => setImmediate(resolve));
      waiter.wake('o1');

      await expect(pending).resolves.toMatchObject({ phase: 'result' });
      expect(started).toHaveBeenCalledWith(
        'o1',
        expect.objectContaining({ pollMs: 2000, timeoutMs: 5000 }),
      );
      expect(engine.getState).toHaveBeenCalledTimes(2);
    });

    it('reads exactly once when wait is absent', async () => {
      engine.getState.mockResolvedValue(state({ pending: { connectorId: 'c', parkedAt: null } }));

      await service.getSession(token);

      expect(engine.getState).toHaveBeenCalledTimes(1);
    });
  });

  it('answers SESSION_NOT_FOUND for an unknown token on every route', async () => {
    const expected = { response: { code: 'SESSION_NOT_FOUND' }, status: 404 };

    await expect(service.getSession('nope')).rejects.toMatchObject(expected);
    await expect(service.submit('nope', {})).rejects.toMatchObject(expected);
    await expect(service.run('nope')).rejects.toMatchObject(expected);
  });

  describe('submit', () => {
    it('forwards the values and returns the re-fetched view', async () => {
      engine.submit.mockResolvedValue({});
      engine.getState.mockResolvedValue(state({ currentStep: 'credit_consent' }));

      await expect(service.submit(token, { firstName: 'Sherlock' })).resolves.toMatchObject({
        phase: 'collect',
      });
      expect(engine.submit).toHaveBeenCalledWith('o1', { firstName: 'Sherlock' });
    });

    it('maps ONBOARDING_AWAITING_CONNECTOR to processing without re-sending', async () => {
      engine.submit.mockRejectedValue(
        new EngineError(409, 'ONBOARDING_AWAITING_CONNECTOR', 'parked'),
      );

      await expect(service.submit(token, {})).resolves.toEqual({ phase: 'processing' });
      expect(engine.submit).toHaveBeenCalledTimes(1);
    });

    it('maps INVALID_STEP_DATA to a 400 carrying the field errors', async () => {
      engine.submit.mockRejectedValue(
        new EngineError(400, 'INVALID_STEP_DATA', 'bad', { email: ['REQUIRED'] }),
      );

      await expect(service.submit(token, {})).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_STEP_DATA', errors: { email: ['REQUIRED'] } },
      });
    });

    it('maps an engine 5xx and a transport failure to 502', async () => {
      engine.submit.mockRejectedValueOnce(new EngineError(500, undefined, 'boom'));
      await expect(service.submit(token, {})).rejects.toMatchObject({ status: 502 });

      engine.submit.mockRejectedValueOnce(EngineError.transport('down'));
      await expect(service.submit(token, {})).rejects.toMatchObject({ status: 502 });
    });

    it('answers 502 and not a pass-through for an engine 400 without a code', async () => {
      engine.submit.mockRejectedValue(new EngineError(400, undefined, 'validation'));

      await expect(service.submit(token, {})).rejects.toMatchObject({
        status: 502,
        response: { code: 'ENGINE_UNAVAILABLE' },
      });
    });
  });

  describe('run', () => {
    it('pushes the persona and answers processing', async () => {
      await expect(service.run(token)).resolves.toEqual({ phase: 'processing' });
      expect(pusher.push).toHaveBeenCalledWith('o1', 'sherlock_holmes');
    });

    it('also answers processing when the push meets a parked connector', async () => {
      pusher.push.mockRejectedValue(
        new EngineError(409, 'ONBOARDING_AWAITING_CONNECTOR', 'parked'),
      );

      await expect(service.run(token)).resolves.toEqual({ phase: 'processing' });
    });
  });

  describe('engine error table', () => {
    // The codes the creating-engine-bffs contract documents for the customer routes.
    const documentedCodes = [
      'INVALID_STEP_DATA',
      'INVALID_DOCUMENT_UPLOAD',
      'ONBOARDING_NOT_FOUND',
      'DOCUMENT_UPLOAD_NOT_FOUND',
      'WORKFLOW_NOT_FOUND',
      'ONBOARDING_COMPLETED',
      'MANUAL_TRANSITION_NOT_AVAILABLE',
      'UNKNOWN_WORKFLOW_EVALUATION',
      'DOCUMENT_UPLOAD_CONFLICT',
      'DOCUMENT_UPLOAD_EXPIRED',
      'WORKFLOW_RETIRED',
      'CONNECTOR_NOT_CONFIGURED',
      'AGREEMENT_NOT_PUBLISHED',
    ];

    it.each(documentedCodes)('maps %s deliberately', (code) => {
      expect(ENGINE_ERROR_MAP).toHaveProperty(code);
    });

    it('maps conflicts to 409 and a vanished onboarding to 404', () => {
      const error = new EngineError(409, 'x', 'm');

      expect(ENGINE_ERROR_MAP.ONBOARDING_COMPLETED(error)).toMatchObject({ status: 409 });
      expect(ENGINE_ERROR_MAP.ONBOARDING_NOT_FOUND(error)).toMatchObject({ status: 404 });
    });

    it('answers 502 for a code outside the table', async () => {
      engine.submit.mockRejectedValue(new EngineError(409, 'SOMETHING_NEW', 'm'));

      await expect(service.submit(token, {})).rejects.toMatchObject({ status: 502 });
    });
  });
});
