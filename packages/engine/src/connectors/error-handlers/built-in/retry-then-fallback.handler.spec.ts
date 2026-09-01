import { DEFAULT_CONNECTOR_RETRY, type NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';
import {
  ConnectorFailureAction,
  type ConnectorFailure,
} from '../../ports/connector-error-handler.port';
import { RetryThenFallbackHandler } from './retry-then-fallback.handler';

const buildDeclaration = (): NormalizedWorkflowConnectorFallback => ({
  name: 'primary_email',
  id: 'sendgrid_email',
  type: 'email_delivery',
  canReject: false,
  async: false,
  order: 1,
  fieldMapping: {},
  optionalFieldMapping: {},
  config: {},
  retry: DEFAULT_CONNECTOR_RETRY,
});

const buildFailure = (overrides: Partial<ConnectorFailure> = {}): ConnectorFailure => ({
  declaration: buildDeclaration(),
  execution: { onboardingId: 'onboarding-1', stepName: 'send_notification' },
  error: new Error('boom'),
  attempt: 1,
  retry: DEFAULT_CONNECTOR_RETRY,
  fallbackAvailable: true,
  ...overrides,
});

describe('RetryThenFallbackHandler', () => {
  const handler = new RetryThenFallbackHandler();

  it('names itself retry_then_fallback', () => {
    expect(handler.id).toBe('retry_then_fallback');
  });

  it('falls back at once on a 4xx status, without retrying', () => {
    expect(handler.handle(buildFailure({ status: 404, attempt: 1, fallbackAvailable: true }))).toBe(
      ConnectorFailureAction.FALLBACK,
    );
  });

  it('propagates at once on a 4xx status when no fallback is available', () => {
    expect(
      handler.handle(buildFailure({ status: 400, attempt: 1, fallbackAvailable: false })),
    ).toBe(ConnectorFailureAction.PROPAGATE);
  });

  it('retries on the first attempt of a 5xx status', () => {
    expect(handler.handle(buildFailure({ status: 503, attempt: 1 }))).toBe(
      ConnectorFailureAction.RETRY,
    );
  });

  it('retries on the first attempt when the error carries no status', () => {
    expect(handler.handle(buildFailure({ status: undefined, attempt: 1 }))).toBe(
      ConnectorFailureAction.RETRY,
    );
  });

  it('falls back on a second attempt of a 5xx status', () => {
    expect(handler.handle(buildFailure({ status: 503, attempt: 2, fallbackAvailable: true }))).toBe(
      ConnectorFailureAction.FALLBACK,
    );
  });

  it('propagates on a second attempt when no fallback is available', () => {
    expect(
      handler.handle(buildFailure({ status: 503, attempt: 2, fallbackAvailable: false })),
    ).toBe(ConnectorFailureAction.PROPAGATE);
  });

  it.each([1, 2, 3])('retries attempt %i while the declared policy allows four', (attempt) => {
    expect(
      handler.handle(buildFailure({ status: 503, attempt, retry: { maxAttempts: 4, delayMs: 0 } })),
    ).toBe(ConnectorFailureAction.RETRY);
  });

  it('falls back once the declared attempts are spent, however many that is', () => {
    expect(
      handler.handle(
        buildFailure({ status: 503, attempt: 4, retry: { maxAttempts: 4, delayMs: 0 } }),
      ),
    ).toBe(ConnectorFailureAction.FALLBACK);
  });

  it('never retries a declaration allowed a single attempt', () => {
    expect(
      handler.handle(
        buildFailure({ status: 503, attempt: 1, retry: { maxAttempts: 1, delayMs: 0 } }),
      ),
    ).toBe(ConnectorFailureAction.FALLBACK);
  });
});
