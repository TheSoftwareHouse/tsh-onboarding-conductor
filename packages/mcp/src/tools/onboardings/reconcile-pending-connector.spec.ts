import { ConfirmationError, ConfirmationService } from '../../confirmation/confirmation.service';
import { EngineClient } from '../../engine/engine-client';
import { CallerIdentity, RequestContext } from '../../request-context/request-context';
import { ToolError } from '../tool-error';
import { ReconcilePendingConnectorTool } from './reconcile-pending-connector.tool';

const ANALYST: CallerIdentity = { kind: 'user', objectId: 'oid-1', upn: 'a@example.com' };
const CONTEXT: RequestContext = { identity: ANALYST, engineToken: 'token' };
const ONBOARDING_ID = '01a19540-7818-7323-8125-eb9dfa7bd656';
const OTHER_ID = '01a19540-8263-74cc-9e95-0919c01431bf';
const PARKED_AT = '2026-10-30T10:00:00.000Z';
const SUMMARY_PATH = '/v1/onboardings/{id}';
const RECONCILE_PATH = '/v1/onboardings/{id}/pending-connector/reconcile';

const PARKED = {
  onboardingId: ONBOARDING_ID,
  workflowId: 'analyst-investigation',
  workflowVersion: 1,
  status: 'awaiting_user',
  currentStep: 'check_identity',
  expiresAt: null,
  createdAt: '2026-10-30T09:00:00.000Z',
  updatedAt: PARKED_AT,
  completedAt: null,
  rejectionReason: null,
  scores: { risk: 0 },
  agreementStatus: 'not_accepted',
  pendingConnector: {
    connectorId: 'mock_async_callback_2',
    connectorName: 'mock_async_callback_2',
    connectorOrder: 1,
    parkedAt: PARKED_AT,
  },
};

describe('ReconcilePendingConnectorTool', () => {
  let request: jest.Mock;
  let tool: ReconcilePendingConnectorTool;
  let onboarding: typeof PARKED;

  const engineWrites = () => request.mock.calls.filter(([method]) => method === 'post');

  beforeEach(() => {
    onboarding = PARKED;
    request = jest.fn((method: string, path: string) => {
      if (path === SUMMARY_PATH) {
        return Promise.resolve(onboarding);
      }
      expect(method).toBe('post');
      expect(path).toBe(RECONCILE_PATH);
      return Promise.resolve({
        outcome: 'applied',
        onboarding: {
          ...onboarding,
          status: 'approved',
          currentStep: null,
          pendingConnector: null,
        },
      });
    });
    tool = new ReconcilePendingConnectorTool(
      { request } as unknown as EngineClient,
      new ConfirmationService('k'.repeat(32)),
    );
  });

  async function preview(): Promise<{ confirmationToken: string } & Record<string, unknown>> {
    return (await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)) as never;
  }

  it('previews the parked onboarding with a token and writes nothing', async () => {
    const result = await preview();

    expect(result).toMatchObject({
      confirmationRequired: true,
      onboarding: { status: 'awaiting_user', currentStep: 'check_identity' },
      pendingConnector: { connectorId: 'mock_async_callback_2' },
      parkedSince: PARKED_AT,
      confirmationToken: expect.any(String),
    });
    expect(engineWrites()).toHaveLength(0);
  });

  it('refuses, issuing no token, when the onboarding is not parked', async () => {
    onboarding = {
      ...PARKED,
      status: 'rejected',
      currentStep: null,
      pendingConnector: null,
    } as never;

    const outcome = tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT);

    await expect(outcome).rejects.toThrow(ToolError);
    await expect(outcome).rejects.toThrow('not parked');
    expect(engineWrites()).toHaveLength(0);
  });

  it('reconciles exactly once with a valid token and returns the masked result', async () => {
    const { confirmationToken } = await preview();

    const result = await tool.handler({ onboardingId: ONBOARDING_ID, confirmationToken }, CONTEXT);

    expect(result).toMatchObject({
      outcome: 'applied',
      onboarding: { status: 'approved', pendingConnector: null },
    });
    expect(engineWrites()).toEqual([
      ['post', RECONCILE_PATH, CONTEXT, { path: { id: ONBOARDING_ID } }],
    ]);
  });

  it('refuses a reused token, another onboarding, another analyst and a garbage token without writing', async () => {
    const { confirmationToken } = await preview();
    await tool.handler({ onboardingId: ONBOARDING_ID, confirmationToken }, CONTEXT);
    request.mockClear();

    const attempts = [
      tool.handler({ onboardingId: ONBOARDING_ID, confirmationToken }, CONTEXT),
      tool.handler({ onboardingId: OTHER_ID, confirmationToken }, CONTEXT),
      tool.handler(
        { onboardingId: ONBOARDING_ID, confirmationToken },
        { identity: { kind: 'user', objectId: 'oid-2', upn: 'b@example.com' } },
      ),
      tool.handler({ onboardingId: ONBOARDING_ID, confirmationToken: 'garbage' }, CONTEXT),
      tool.handler({ onboardingId: ONBOARDING_ID, confirmationToken: 42 }, CONTEXT),
    ];

    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrow(ConfirmationError);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts a token when the model adds arguments the preview did not have', async () => {
    const { confirmationToken } = await preview();

    await tool.handler({ onboardingId: ONBOARDING_ID, confirmationToken, note: 'extra' }, CONTEXT);

    expect(engineWrites()).toHaveLength(1);
  });
});
