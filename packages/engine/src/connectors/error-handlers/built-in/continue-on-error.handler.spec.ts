import { DEFAULT_CONNECTOR_RETRY, type NormalizedWorkflowConnectorFallback } from '@tsh/ddl-schema';
import {
  ConnectorFailureAction,
  type ConnectorErrorHandler,
  type ConnectorFailure,
} from '../../ports/connector-error-handler.port';
import { ContinueOnErrorHandler } from './continue-on-error.handler';

const buildDeclaration = (): NormalizedWorkflowConnectorFallback => ({
  name: 'optional_notice',
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
  execution: { onboardingId: 'onboarding-1', stepName: 'optional_notice' },
  error: new Error('boom'),
  attempt: 1,
  retry: DEFAULT_CONNECTOR_RETRY,
  fallbackAvailable: false,
  ...overrides,
});

describe('ContinueOnErrorHandler', () => {
  const handler: ConnectorErrorHandler = new ContinueOnErrorHandler();

  it('names itself continue_on_error', () => {
    expect(handler.id).toBe('continue_on_error');
  });

  it('always continues, regardless of fallback availability or status', () => {
    expect(handler.handle(buildFailure({ fallbackAvailable: true, status: 500 }))).toBe(
      ConnectorFailureAction.CONTINUE,
    );
    expect(handler.handle(buildFailure({ fallbackAvailable: false, status: undefined }))).toBe(
      ConnectorFailureAction.CONTINUE,
    );
  });
});
