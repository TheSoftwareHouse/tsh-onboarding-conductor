import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineError } from '../engine/engine-error';
import { EngineClient, OnboardingState, StateField } from '../engine/engine.client';
import { LeanLinkService } from '../lean/lean-link.service';
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

const ACCOUNTS = [
  { id: 'account-01', type: 'CHECKING' },
  { id: 'account-02', type: 'SAVINGS' },
];

const UK_CONFIG: Record<string, string | undefined> = {
  BNPL_WORKFLOW_ID: 'wf',
  BNPL_JOURNEY: 'uk-algoan',
  DEMO_WEB_PUBLIC_ORIGIN: undefined,
};
const KSA_CONFIG: Record<string, string | undefined> = {
  BNPL_WORKFLOW_ID: 'wf-ksa',
  BNPL_JOURNEY: 'ksa-lean-algoan',
  DEMO_WEB_PUBLIC_ORIGIN: 'https://demo.example.ngrok-free.dev/',
};

const LINK = {
  appToken: 'app',
  customerId: '22222222-2222-4222-8222-222222222222',
  accessToken: 'customer-token',
  sandbox: true,
  permissions: ['identity'],
  accountType: 'PERSONAL',
};

describe('BnplService', () => {
  let engine: { startOnboarding: jest.Mock; getState: jest.Mock; submit: jest.Mock };
  let personas: { accounts: jest.Mock; summary: jest.Mock };
  let leanLink: { createLink: jest.Mock };
  let pusher: { push: jest.Mock };
  let store: BnplSessionStore;
  let service: BnplService;
  let token: string;

  const build = (config: Record<string, string | undefined>) =>
    new BnplService(
      { get: (key: string) => config[key] } as unknown as ConfigService<AppConfig, true>,
      engine as unknown as EngineClient,
      store,
      new StateWaiter(),
      personas as unknown as PersonaService,
      pusher as unknown as BankDataPusher,
      leanLink as unknown as LeanLinkService,
    );

  beforeEach(async () => {
    engine = { startOnboarding: jest.fn(), getState: jest.fn(), submit: jest.fn() };
    personas = {
      accounts: jest.fn().mockReturnValue(ACCOUNTS),
      summary: jest.fn().mockReturnValue({ id: 'sherlock_holmes', profile: 'high' }),
    };
    leanLink = {
      createLink: jest
        .fn()
        .mockImplementation((_id: string, redirects: unknown) =>
          Promise.resolve({ ...LINK, redirects }),
        ),
    };
    pusher = { push: jest.fn().mockResolvedValue(undefined) };
    store = new BnplSessionStore();
    service = build(UK_CONFIG);
    engine.startOnboarding.mockResolvedValue({ onboardingId: 'o1' });
    // Every submit reads the step first; the applicant step is submittable.
    engine.getState.mockResolvedValue(state());
    ({ token } = await service.createSession('sherlock_holmes'));
  });

  describe('createSession', () => {
    it('starts the configured workflow and binds the token to the onboarding', async () => {
      expect(engine.startOnboarding).toHaveBeenCalledWith('wf');
      expect(store.get(token)).toMatchObject({ onboardingId: 'o1', persona: 'sherlock_holmes' });
    });

    it('starts a session without a persona, with no accounts to show', async () => {
      engine.getState.mockResolvedValue(state());

      personas.summary.mockClear();
      const created = await service.createSession();

      expect(created.persona).toBeNull();
      expect(personas.summary).toHaveBeenCalledTimes(0);
      await expect(service.getSession(created.token)).resolves.toMatchObject({ persona: null });
      expect(await service.getSession(created.token)).not.toHaveProperty('accounts');
    });

    it('rejects an unknown persona with UNKNOWN_PERSONA before starting anything', async () => {
      engine.startOnboarding.mockClear();
      personas.summary.mockImplementation(() => {
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
        journey: 'uk-algoan',
        step: 'applicant',
        fields: [{ name: 'firstName', type: 'text', required: true, value: null }],
        data: {},
        persona: 'sherlock_holmes',
        accounts: ACCOUNTS,
      });
    });

    it('maps a parked connector to processing', async () => {
      engine.getState.mockResolvedValue(
        state({ pending: { connectorId: 'algoan_credit', parkedAt: null } }),
      );

      await expect(service.getSession(token)).resolves.toMatchObject({
        phase: 'processing',
        waitingFor: 'credit',
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

  describe('accounts in the view', () => {
    it('lists every account while collecting', async () => {
      engine.getState.mockResolvedValue(state({ data: { selectedAccounts: ['account-02'] } }));

      await expect(service.getSession(token)).resolves.toMatchObject({ accounts: ACCOUNTS });
    });

    it('lists only the selected accounts on a result', async () => {
      engine.getState.mockResolvedValue(
        state({
          terminal: true,
          status: 'approved',
          step: null,
          data: { creditOutcome: 'approved', selectedAccounts: ['account-01'] },
        }),
      );

      const view = await service.getSession(token);

      expect(view.accounts).toEqual([ACCOUNTS[0]]);
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

  describe('submit of a BFF-owned step', () => {
    const atStep = (name: string) => state({ currentStep: name, step: { ...state().step!, name } });

    it.each([
      ['bank_connection', 'bank-login'],
      ['credit_check', 'run'],
    ])(
      'refuses %s with 409 SESSION_STEP_NOT_SUBMITTABLE naming the %s route',
      async (step, route) => {
        engine.getState.mockResolvedValue(atStep(step));

        await expect(service.submit(token, { bankProfile: 'high' })).rejects.toMatchObject({
          status: 409,
          response: { code: 'SESSION_STEP_NOT_SUBMITTABLE', step, route },
        });
        expect(engine.submit).not.toHaveBeenCalled();
      },
    );

    it('forwards every other step, and a finished session with no step, to the engine', async () => {
      engine.submit.mockResolvedValue({});
      engine.getState.mockResolvedValue(atStep('bank_access_consent'));
      await service.submit(token, { bankDataAccessConsent: true });

      engine.getState.mockResolvedValue(state({ step: null, terminal: true, status: 'approved' }));
      await service.submit(token, {});

      expect(engine.submit).toHaveBeenCalledTimes(2);
    });
  });

  describe('submit of account_selection', () => {
    it('rejects a selection without the checking account before the engine sees it', async () => {
      await expect(
        service.submit(token, { selectedAccounts: ['account-02'] }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'INVALID_STEP_DATA',
          errors: { selectedAccounts: ['CHECKING_ACCOUNT_REQUIRED'] },
        },
      });
      expect(engine.submit).not.toHaveBeenCalled();
    });

    it('rejects ids that match no account', async () => {
      await expect(
        service.submit(token, { selectedAccounts: ['account-09'] }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('forwards a selection that includes the checking account', async () => {
      engine.submit.mockResolvedValue({});
      engine.getState.mockResolvedValue(state());

      await service.submit(token, { selectedAccounts: ['account-01', 'account-02'] });

      expect(engine.submit).toHaveBeenCalledWith('o1', {
        selectedAccounts: ['account-01', 'account-02'],
      });
    });

    it('leaves a session without a persona to the engine', async () => {
      engine.submit.mockResolvedValue({});
      engine.getState.mockResolvedValue(state());
      const { token: bare } = await service.createSession();

      await service.submit(bare, { selectedAccounts: ['account-02'] });

      expect(engine.submit).toHaveBeenCalledTimes(1);
    });
  });

  describe('bankLogin', () => {
    const atBank = () =>
      state({
        currentStep: 'bank_connection',
        step: { ...state().step!, name: 'bank_connection' },
      });

    it('sets the persona and submits an opaque reference, the method and the profile', async () => {
      const bare = await service.createSession();
      personas.summary.mockReturnValue({ id: 'james_watson', profile: 'medium' });
      engine.getState.mockResolvedValue(atBank());
      engine.submit.mockResolvedValue({});

      const view = await service.bankLogin(bare.token, 'james_watson', 'qr');

      expect(engine.submit).toHaveBeenCalledWith('o1', {
        bankConnectionReference: expect.stringMatching(/^[a-f0-9]{32}$/),
        bankConnectionMethod: 'qr',
        bankProfile: 'medium',
      });
      expect(store.get(bare.token)?.persona).toBe('james_watson');
      expect(view).toMatchObject({ persona: 'james_watson', accounts: ACCOUNTS });
    });

    it('answers 409 SESSION_HAS_NO_BANK away from the bank connection step', async () => {
      engine.getState.mockResolvedValue(state());

      await expect(service.bankLogin(token, 'sherlock_holmes', 'device')).rejects.toMatchObject({
        status: 409,
        response: { code: 'SESSION_HAS_NO_BANK' },
      });
      expect(engine.submit).not.toHaveBeenCalled();
    });

    it('answers UNKNOWN_PERSONA before reading the engine', async () => {
      personas.summary.mockImplementation(() => {
        throw new PersonaNotFoundError('nobody');
      });

      await expect(service.bankLogin(token, 'nobody', 'qr')).rejects.toMatchObject({
        response: { code: 'UNKNOWN_PERSONA' },
      });
      expect(engine.getState).not.toHaveBeenCalled();
    });

    it('maps an engine failure on the submit to the BFF contract', async () => {
      engine.getState.mockResolvedValue(atBank());
      engine.submit.mockRejectedValue(EngineError.transport('down'));

      await expect(service.bankLogin(token, 'sherlock_holmes', 'qr')).rejects.toMatchObject({
        status: 502,
      });
    });

    it('leaves the persona unchanged when the engine refuses the submit', async () => {
      const bare = await service.createSession();
      personas.summary.mockReturnValue({ id: 'james_watson', profile: 'medium' });
      engine.getState.mockResolvedValue(atBank());
      engine.submit.mockRejectedValue(EngineError.transport('down'));

      await expect(service.bankLogin(bare.token, 'james_watson', 'qr')).rejects.toMatchObject({
        status: 502,
      });
      expect(store.get(bare.token)?.persona).toBeNull();
    });
  });

  describe('run', () => {
    const selected = () => state({ data: { selectedAccounts: ['account-01', 'account-02'] } });

    it('pushes the persona with the engine-recorded selection and answers processing', async () => {
      engine.getState.mockResolvedValue(selected());

      await expect(service.run(token)).resolves.toEqual({ phase: 'processing' });
      expect(pusher.push).toHaveBeenCalledWith('o1', 'sherlock_holmes', [
        'account-01',
        'account-02',
      ]);
    });

    it('answers 409 ACCOUNTS_NOT_SELECTED when the engine holds no selection', async () => {
      engine.getState.mockResolvedValue(state());

      await expect(service.run(token)).rejects.toMatchObject({
        status: 409,
        response: { code: 'ACCOUNTS_NOT_SELECTED' },
      });
      expect(pusher.push).not.toHaveBeenCalled();
    });

    it('answers 409 ACCOUNTS_NOT_SELECTED for a session without a persona', async () => {
      engine.getState.mockResolvedValue(selected());
      const { token: bare } = await service.createSession();

      await expect(service.run(bare)).rejects.toMatchObject({
        response: { code: 'ACCOUNTS_NOT_SELECTED' },
      });
    });

    it('also answers processing when the push meets a parked connector', async () => {
      engine.getState.mockResolvedValue(selected());
      pusher.push.mockRejectedValue(
        new EngineError(409, 'ONBOARDING_AWAITING_CONNECTOR', 'parked'),
      );

      await expect(service.run(token)).resolves.toEqual({ phase: 'processing' });
    });

    it('answers 409 STEP_NOT_READY when the engine refuses the reservation on this step', async () => {
      engine.getState.mockResolvedValue(selected());
      pusher.push.mockRejectedValue(new EngineError(400, 'INVALID_DOCUMENT_UPLOAD', 'wrong step'));

      await expect(service.run(token)).rejects.toMatchObject({
        status: 409,
        response: { code: 'STEP_NOT_READY' },
      });
    });

    it.each(['CREDIT_PROVIDER_CREDENTIALS_REJECTED', 'CREDIT_PROVIDER_REJECTED'])(
      'answers 503 CREDIT_CHECK_UNAVAILABLE when the engine reports %s',
      async (code) => {
        engine.getState.mockResolvedValue(selected());
        pusher.push.mockRejectedValue(new EngineError(503, code, 'refused'));

        await expect(service.run(token)).rejects.toMatchObject({
          status: 503,
          response: { code: 'CREDIT_CHECK_UNAVAILABLE' },
        });
      },
    );
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
      'CREDIT_PROVIDER_CREDENTIALS_REJECTED',
      'CREDIT_PROVIDER_REJECTED',
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

  describe('KSA journey', () => {
    const BANK_ACCOUNTS = {
      accounts: [
        {
          id: 'account-01',
          type: 'CHECKING',
          name: 'Current account',
          accountNumber: '1309',
          balance: 197,
          currency: 'GBP',
          bankName: 'Mockbank 1',
        },
        {
          id: 'account-02',
          type: 'SAVINGS',
          name: 'Savings account',
          accountNumber: null,
          balance: 10,
          currency: 'GBP',
          bankName: 'Mockbank 1',
        },
      ],
    };
    const atStep = (name: string, overrides: Partial<OnboardingState> = {}) =>
      state({ currentStep: name, step: { ...state().step!, name }, ...overrides });
    let ksaToken: string;

    beforeEach(async () => {
      service = build(KSA_CONFIG);
      ({ token: ksaToken } = await service.createSession());
    });

    it('starts the KSA workflow and reports the journey on every view', async () => {
      expect(engine.startOnboarding).toHaveBeenLastCalledWith('wf-ksa');
      expect(service.journeyOf()).toBe('ksa-lean-algoan');
      await expect(service.getSession(ksaToken)).resolves.toMatchObject({
        journey: 'ksa-lean-algoan',
        persona: null,
      });
      expect(await service.getSession(ksaToken)).not.toHaveProperty('accounts');
    });

    it('refuses any persona: the KSA journey has none', async () => {
      personas.summary.mockClear();

      await expect(service.createSession('sherlock_holmes')).rejects.toMatchObject({
        response: { code: 'UNKNOWN_PERSONA' },
      });
      expect(personas.summary).not.toHaveBeenCalled();
    });

    describe('bankLink', () => {
      it('mints the link and parks bank_connect on the customer', async () => {
        engine.getState.mockResolvedValue(atStep('bank_connect'));
        engine.submit.mockResolvedValue({});

        const link = await service.bankLink(ksaToken);

        expect(leanLink.createLink).toHaveBeenCalledWith('o1', {
          success: `https://demo.example.ngrok-free.dev/s/${encodeURIComponent(ksaToken)}/bank/waiting?lean_redirect=success`,
          fail: `https://demo.example.ngrok-free.dev/s/${encodeURIComponent(ksaToken)}/bank/waiting?lean_redirect=fail`,
        });
        expect(engine.submit).toHaveBeenCalledWith('o1', { leanCustomerId: LINK.customerId });
        expect(link).toMatchObject({ customerId: LINK.customerId, accessToken: 'customer-token' });
        expect(store.get(ksaToken)?.persona).toBeNull();
      });

      it('mints a fresh token without a second submit while the step is already parked', async () => {
        engine.getState.mockResolvedValue(
          atStep('bank_connect', { pending: { connectorId: 'lean_bank_data', parkedAt: null } }),
        );

        await service.bankLink(ksaToken);

        expect(engine.submit).not.toHaveBeenCalled();
        expect(store.get(ksaToken)?.persona).toBeNull();
      });

      it('tolerates the engine answering that the step is already parked', async () => {
        engine.getState.mockResolvedValue(atStep('bank_connect'));
        engine.submit.mockRejectedValue(
          new EngineError(409, 'ONBOARDING_AWAITING_CONNECTOR', 'parked'),
        );

        await expect(service.bankLink(ksaToken)).resolves.toMatchObject({ appToken: 'app' });
      });

      it('answers 409 SESSION_HAS_NO_BANK away from bank_connect, before touching Lean', async () => {
        engine.getState.mockResolvedValue(state());

        await expect(service.bankLink(ksaToken)).rejects.toMatchObject({
          status: 409,
          response: { code: 'SESSION_HAS_NO_BANK' },
        });
        expect(leanLink.createLink).not.toHaveBeenCalled();
      });

      it('maps an engine refusal of the customer id to the BFF contract', async () => {
        engine.getState.mockResolvedValue(atStep('bank_connect'));
        engine.submit.mockRejectedValue(
          new EngineError(400, 'INVALID_STEP_DATA', 'no', { leanCustomerId: ['invalid'] }),
        );

        await expect(service.bankLink(ksaToken)).rejects.toMatchObject({
          status: 400,
          response: { code: 'INVALID_STEP_DATA', errors: { leanCustomerId: ['invalid'] } },
        });
      });
    });

    it('refuses bank_connect and credit_check on submit, naming bank-link and run', async () => {
      for (const [step, route] of [
        ['bank_connect', 'bank-link'],
        ['credit_check', 'run'],
      ]) {
        engine.getState.mockResolvedValue(atStep(step));

        await expect(service.submit(ksaToken, {})).rejects.toMatchObject({
          response: { code: 'SESSION_STEP_NOT_SUBMITTABLE', step, route },
        });
      }
      expect(engine.submit).not.toHaveBeenCalled();
    });

    it('reports waiting for the bank while parked on lean_bank_data', async () => {
      engine.getState.mockResolvedValue(
        atStep('bank_connect', { pending: { connectorId: 'lean_bank_data', parkedAt: null } }),
      );

      await expect(service.getSession(ksaToken)).resolves.toMatchObject({
        phase: 'processing',
        waitingFor: 'bank',
      });
    });

    it('walks bank_data_gate with an empty submit so the web app never sees it', async () => {
      engine.getState
        .mockResolvedValueOnce(
          atStep('bank_data_gate', { data: { bankConnectOutcome: 'connected' } }),
        )
        .mockResolvedValueOnce(
          atStep('account_selection', {
            data: { bankConnectOutcome: 'connected', bankAccounts: BANK_ACCOUNTS },
          }),
        );
      engine.submit.mockResolvedValue({});

      const view = await service.getSession(ksaToken);

      expect(engine.submit).toHaveBeenCalledWith('o1', {});
      expect(view.step).toBe('account_selection');
      expect(view.accounts).toEqual([
        expect.objectContaining({ id: 'account-01', type: 'CHECKING', owner: null, balance: 197 }),
        expect.objectContaining({ id: 'account-02', type: 'SAVINGS', accountNumber: null }),
      ]);
    });

    it('does not walk a gate that is parked or finished', async () => {
      engine.getState.mockResolvedValue(
        atStep('bank_data_gate', { pending: { connectorId: 'lean_bank_data', parkedAt: null } }),
      );

      await service.getSession(ksaToken);

      expect(engine.submit).not.toHaveBeenCalled();
    });

    it('mirrors the checking-account rule from the exported summary', async () => {
      engine.getState.mockResolvedValue(
        atStep('account_selection', { data: { bankAccounts: BANK_ACCOUNTS } }),
      );

      await expect(
        service.submit(ksaToken, { selectedAccounts: ['account-02'] }),
      ).rejects.toMatchObject({
        response: { errors: { selectedAccounts: ['CHECKING_ACCOUNT_REQUIRED'] } },
      });
      expect(engine.submit).not.toHaveBeenCalled();

      engine.submit.mockResolvedValue({});
      await service.submit(ksaToken, { selectedAccounts: ['account-01'] });
      expect(engine.submit).toHaveBeenCalledWith('o1', { selectedAccounts: ['account-01'] });
      expect(personas.accounts).not.toHaveBeenCalled();
    });

    describe('run', () => {
      const selected = () =>
        atStep('credit_check', {
          data: { selectedAccounts: ['account-01'], bankAccounts: BANK_ACCOUNTS },
        });

      it('starts the credit check with an empty submit and answers processing', async () => {
        engine.getState.mockResolvedValue(selected());
        engine.submit.mockRejectedValue(
          new EngineError(409, 'ONBOARDING_AWAITING_CONNECTOR', 'parked'),
        );

        await expect(service.run(ksaToken)).resolves.toEqual({ phase: 'processing' });
        expect(engine.submit).toHaveBeenCalledWith('o1', {});
        expect(pusher.push).not.toHaveBeenCalled();
      });

      it('answers 409 ACCOUNTS_NOT_SELECTED when the engine holds no selection', async () => {
        engine.getState.mockResolvedValue(atStep('credit_check'));

        await expect(service.run(ksaToken)).rejects.toMatchObject({
          response: { code: 'ACCOUNTS_NOT_SELECTED' },
        });
        expect(engine.submit).not.toHaveBeenCalled();
      });

      it('passes NO_ACCOUNTS_SELECTED through as a 400 on selectedAccounts', async () => {
        engine.getState.mockResolvedValue(selected());
        engine.submit.mockRejectedValue(
          new EngineError(400, 'INVALID_STEP_DATA', 'no', {
            selectedAccounts: ['NO_ACCOUNTS_SELECTED'],
          }),
        );

        await expect(service.run(ksaToken)).rejects.toMatchObject({
          status: 400,
          response: { errors: { selectedAccounts: ['NO_ACCOUNTS_SELECTED'] } },
        });
      });

      it('answers 503 CREDIT_CHECK_UNAVAILABLE when the engine reports LEAN_UNAVAILABLE', async () => {
        engine.getState.mockResolvedValue(selected());
        engine.submit.mockRejectedValue(new EngineError(500, 'LEAN_UNAVAILABLE', 'down'));

        await expect(service.run(ksaToken)).rejects.toMatchObject({
          response: { code: 'CREDIT_CHECK_UNAVAILABLE' },
        });
      });
    });

    it('lists only the selected exported accounts on a result', async () => {
      engine.getState.mockResolvedValue(
        state({
          terminal: true,
          status: 'approved',
          step: null,
          data: {
            creditOutcome: 'approved',
            selectedAccounts: ['account-01'],
            bankAccounts: BANK_ACCOUNTS,
          },
        }),
      );

      await expect(service.getSession(ksaToken)).resolves.toMatchObject({
        phase: 'result',
        decision: 'approved',
        accounts: [expect.objectContaining({ id: 'account-01' })],
      });
    });
  });
});
