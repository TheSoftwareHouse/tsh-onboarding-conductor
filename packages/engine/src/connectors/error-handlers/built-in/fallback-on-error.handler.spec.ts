import { DEFAULT_CONNECTOR_RETRY, type NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';
import {
  ConnectorFailureAction,
  type ConnectorFailure,
} from '../../ports/connector-error-handler.port';
import { FallbackOnErrorHandler } from './fallback-on-error.handler';

const buildDeclaration = (): NormalizedWorkflowConnectorFallback => ({
  name: 'primary_email',
  id: 'sendgrid_email',
  type: 'email_delivery',
  canReject: false,
  async: false,
  order: 1,
  fieldMapping: {},
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

describe('FallbackOnErrorHandler', () => {
  const handler = new FallbackOnErrorHandler();

  it('names itself fallback_on_error', () => {
    expect(handler.id).toBe('fallback_on_error');
  });

  it('falls back when a fallback is available', () => {
    expect(handler.handle(buildFailure({ fallbackAvailable: true }))).toBe(
      ConnectorFailureAction.FALLBACK,
    );
  });

  it('propagates when no fallback is available', () => {
    expect(handler.handle(buildFailure({ fallbackAvailable: false }))).toBe(
      ConnectorFailureAction.PROPAGATE,
    );
  });
});
