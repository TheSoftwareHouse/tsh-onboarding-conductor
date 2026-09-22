import type { ConnectorAdapterCollection } from './ports/connector-adapter.port';

export const CONNECTOR_SCOPES = ['built-in', 'fixtures', 'users'] as const;

export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

export const CONNECTOR_ADAPTER_SCOPES = Symbol('CONNECTOR_ADAPTER_SCOPES');

/** Adapter id -> the group it was registered in. */
export type ConnectorAdapterScopes = ReadonlyMap<string, ConnectorScope>;

/** A class value, compared only by identity — never instantiated or called. */
type ConnectorAdapterConstructor = abstract new (...args: never[]) => unknown;

/**
 * A scope name paired with the constructors `connectors.module.ts` registered under it —
 * `BUILT_IN_CONNECTOR_ADAPTER_PROVIDERS`, `FIXTURE_CONNECTOR_ADAPTER_PROVIDERS` and
 * `USER_CONNECTOR_ADAPTER_PROVIDERS`, in that order.
 */
export type ConnectorAdapterScopeGroups = readonly (readonly [
  ConnectorScope,
  readonly ConnectorAdapterConstructor[],
])[];

/**
 * Derives which group registered each adapter from the provider arrays `connectors.module.ts`
 * already splits by group, instead of asking the adapter to say so about itself. A field on the
 * adapter would be a second statement of the same fact, free to drift from the array that
 * actually decides what the engine boots with; the array is kept as the single source of truth.
 *
 * An adapter is matched to its group by exact constructor identity (`===`), never `instanceof`:
 * a user adapter that subclasses a built-in one must still report `users`, and `instanceof`
 * would report it as whichever ancestor it extends instead of where it was registered. An
 * adapter matching no listed group is `users` — the engine ships what the built-in and fixture
 * arrays name, and anything else came from outside.
 */
export function resolveConnectorAdapterScopes(
  adapters: ConnectorAdapterCollection,
  groups: ConnectorAdapterScopeGroups,
): ConnectorAdapterScopes {
  const scopes = new Map<string, ConnectorScope>();

  for (const adapter of adapters) {
    const group = groups.find(([, constructors]) =>
      constructors.some((constructor) => constructor === adapter.constructor),
    );
    scopes.set(adapter.id, group?.[0] ?? 'users');
  }

  return scopes;
}
