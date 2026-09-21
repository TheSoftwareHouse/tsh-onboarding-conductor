import { createSerializer } from 'nuqs';
import { parseAsTrimmedString } from '@/lib/search-params';

/** The one criterion Connectors commits to the URL — see ADR 0018. */
export const connectorsSearchParams = {
  type: parseAsTrimmedString,
};

const serialize = createSerializer(connectorsSearchParams);

/** Query string a `ConnectorTypeNav` link commits `type` through; `null` omits the key entirely. */
export function serializeConnectorsSearch(type: string | null): string {
  return serialize({ type });
}

/**
 * The requested type if the list holds it, else the first — `undefined` only for an empty list.
 * An unrecognised value falls back rather than erroring: the engine owns `type`'s vocabulary.
 */
export function findSelectedConnectorType(
  types: readonly string[],
  requested: string | null,
): string | undefined {
  if (requested !== null && types.includes(requested)) {
    return requested;
  }
  return types[0];
}
