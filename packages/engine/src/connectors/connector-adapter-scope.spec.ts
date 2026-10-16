import {
  resolveConnectorAdapterScopes,
  type ConnectorAdapterScopeGroups,
} from './connector-adapter-scope';
import type { ConnectorAdapter } from './ports/connector-adapter.port';
import { ConnectorExecutionResult } from './ports/connector-execution-result';

class BuiltInConnector implements ConnectorAdapter {
  readonly type = 'custom';

  constructor(
    readonly id: string,
    readonly name = id,
  ) {}

  async execute(): Promise<ConnectorExecutionResult> {
    return ConnectorExecutionResult.accepted();
  }
}

class FixtureConnector extends BuiltInConnector {}
class UserConnector extends BuiltInConnector {}
/** A user adapter that subclasses a built-in one — must still report `users`, not `built-in`. */
class UserSubclassOfBuiltInConnector extends BuiltInConnector {}
class UnregisteredConnector extends BuiltInConnector {}

const groups: ConnectorAdapterScopeGroups = [
  ['built-in', [BuiltInConnector]],
  ['fixtures', [FixtureConnector]],
  ['users', [UserConnector, UserSubclassOfBuiltInConnector]],
];

describe('resolveConnectorAdapterScopes', () => {
  it('reports an adapter under the group its constructor was registered in', () => {
    const adapters = [
      new BuiltInConnector('http_request'),
      new FixtureConnector('mock_email_delivery'),
      new UserConnector('acme_verify'),
    ];

    const scopes = resolveConnectorAdapterScopes(adapters, groups);

    expect(scopes.get('http_request')).toBe('built-in');
    expect(scopes.get('mock_email_delivery')).toBe('fixtures');
    expect(scopes.get('acme_verify')).toBe('users');
  });

  it('falls back to users for an adapter registered in no group', () => {
    const scopes = resolveConnectorAdapterScopes(
      [new UnregisteredConnector('custom_thing')],
      groups,
    );

    expect(scopes.get('custom_thing')).toBe('users');
  });

  it('reports a subclass of a built-in adapter registered as a user adapter as users', () => {
    const scopes = resolveConnectorAdapterScopes(
      [new UserSubclassOfBuiltInConnector('otp_clone')],
      groups,
    );

    expect(scopes.get('otp_clone')).toBe('users');
  });

  it('yields an empty map for an empty collection', () => {
    expect(resolveConnectorAdapterScopes([], groups).size).toBe(0);
  });
});
