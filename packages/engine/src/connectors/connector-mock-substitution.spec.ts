import { resolveConnectorMockSubstitutions } from './connector-mock-substitution';
import type { ConnectorAdapter } from './ports/connector-adapter.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';

const createAdapter = (type: string): ConnectorAdapter => ({
  name: type,
  type,
  execute: async () => ConnectorExecutionResult.accepted(),
});

const adapters = [
  createAdapter('twilio_verify'),
  createAdapter('sendgrid_email'),
  createAdapter('mock_phone_verification'),
];

const configured = new Map([['twilio_verify', 'mock_phone_verification']]);

describe('resolveConnectorMockSubstitutions', () => {
  it('resolves no redirect when nothing is configured', () => {
    expect(resolveConnectorMockSubstitutions(adapters, new Map(), 'test').size).toBe(0);
  });

  it('keeps each configured pair once both ends are registered', () => {
    const substitutions = resolveConnectorMockSubstitutions(adapters, configured, 'test');

    expect(substitutions.get('twilio_verify')).toBe('mock_phone_verification');
    expect(substitutions.get('sendgrid_email')).toBeUndefined();
  });

  it('ignores the configured pairs outside a test run, whatever they name', () => {
    for (const nodeEnv of ['development', 'staging', 'production', undefined]) {
      expect(resolveConnectorMockSubstitutions(adapters, configured, nodeEnv).size).toBe(0);

      // Not even a pair that could never work stops a deployment from booting.
      expect(
        resolveConnectorMockSubstitutions(
          adapters,
          new Map([['vonage_verify', 'mock_nonexistent']]),
          nodeEnv,
        ).size,
      ).toBe(0);
    }
  });

  it('fails a test run when nothing serves the connector being mocked', () => {
    expect(() =>
      resolveConnectorMockSubstitutions(
        adapters,
        new Map([['vonage_verify', 'mock_phone_verification']]),
        'test',
      ),
    ).toThrow('asks for type=vonage_verify to be mocked, but no adapter serves it');
  });

  it('fails a test run when the named mock is not registered', () => {
    expect(() =>
      resolveConnectorMockSubstitutions(
        adapters,
        new Map([['sendgrid_email', 'mock_email_delivery']]),
        'test',
      ),
    ).toThrow('no adapter is registered as type=mock_email_delivery');
  });
});
