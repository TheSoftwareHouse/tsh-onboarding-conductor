import { queryOptions } from '@tanstack/react-query';
import { fetchConnectors, type Connector, type ConnectorsFetchError } from './connectors';

/** Sibling module to `connectors.ts` on purpose, so `vi.mock('@/api/connectors/connectors')` still intercepts `list`'s cross-module `queryFn` call. */
export const connectorQueries = {
  all: () => ['connectors'] as const,
  lists: () => [...connectorQueries.all(), 'list'] as const,
  list: () =>
    queryOptions<Connector[], ConnectorsFetchError>({
      queryKey: connectorQueries.lists(),
      queryFn: () => fetchConnectors(),
    }),
};
