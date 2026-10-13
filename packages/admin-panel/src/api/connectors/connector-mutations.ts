import { mutationOptions } from '@/services/query-client/mutation-options';
import { connectorQueries } from './connector-queries';
import { deleteConnectorSettings, patchConnectorSettings } from './connectors';

export const connectorMutations = {
  save: () =>
    mutationOptions({
      mutationFn: ({
        connectorId,
        changes,
      }: {
        connectorId: string;
        changes: Record<string, string | null>;
      }) => patchConnectorSettings(connectorId, changes),
      meta: { invalidates: [connectorQueries.lists()] },
    }),
  clear: () =>
    mutationOptions({
      mutationFn: (connectorId: string) => deleteConnectorSettings(connectorId),
      meta: { invalidates: [connectorQueries.lists()] },
    }),
};
