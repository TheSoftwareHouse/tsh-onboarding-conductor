import { useState, type ReactElement } from 'react';
import { useQueryStates } from 'nuqs';
import { PageHeaderActions } from '@/components/ui/PageHeader/PageHeaderActions/PageHeaderActions';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { ConnectorList } from './components/ConnectorList/ConnectorList';
import { ConnectorTypeNav } from './components/ConnectorTypeNav/ConnectorTypeNav';
import { groupConnectorsByType } from './components/ConnectorList/group-connectors-by-type';
import type { ConnectorCardProps } from './components/ConnectorList/ConnectorCard/ConnectorCard';
import { useConnectors, type ConnectorWriteOutcome } from './hooks/useConnectors';
import type { Connector } from './types/connector';
import {
  connectorsSearchParams,
  findSelectedConnectorType,
} from './utils/connectors-search-params';

/**
 * Composes the connectors tab from `useConnectors`, the `?type=` nav and `ConnectorList`. Each
 * card owns its own form and draft — this page only wires the write callbacks and the message
 * they report through.
 */
export function ConnectorsPage(): ReactElement {
  const { isPending, isError, isSuccess, connectors, error, saveSettings, clearSettings } =
    useConnectors();
  // `type` is read only — the nav commits it by linking straight to `?type=`, the same pattern
  // `AuditResourceTabs` uses. `shallow: false` still matters here: without it a commit never
  // reaches react-router, and `AdminLayout`'s remembered per-section search goes stale.
  const [{ type: requestedType }] = useQueryStates(connectorsSearchParams, { shallow: false });

  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleSave(
    connector: Connector,
    changes: Record<string, string | null>,
  ): Promise<ConnectorWriteOutcome> {
    const outcome = await saveSettings(connector.id, changes);

    setActionMessage(
      outcome.ok
        ? `${connector.name} settings saved.`
        : `Unable to save ${connector.name}: ${outcome.error.message}`,
    );

    return outcome;
  }

  async function handleClear(connector: Connector): Promise<ConnectorWriteOutcome> {
    const outcome = await clearSettings(connector.id);

    setActionMessage(
      outcome.ok
        ? `${connector.name} settings cleared.`
        : `Unable to clear ${connector.name}: ${outcome.error.message}`,
    );

    return outcome;
  }

  function buildCard(connector: Connector): ConnectorCardProps {
    return {
      connector,
      onSave: (changes) => handleSave(connector, changes),
      onClear: () => handleClear(connector),
    };
  }

  let statusMessage: string;

  if (isPending) {
    statusMessage = 'Loading connectors…';
  } else if (isError) {
    statusMessage = error
      ? `Unable to load connectors: ${error.message}`
      : 'Unable to load connectors.';
  } else {
    const configuredCount = connectors.filter((connector) => connector.configured).length;
    statusMessage =
      actionMessage ??
      `${connectors.length} adapter${connectors.length === 1 ? '' : 's'} discovered · ${configuredCount} configured`;
  }

  const cards = isSuccess ? connectors.map(buildCard) : [];
  const { groups, notImplemented } = groupConnectorsByType(cards);
  const selectedType = findSelectedConnectorType(
    groups.map((group) => group.type),
    requestedType,
  );
  const selectedGroup = groups.find((group) => group.type === selectedType);

  return (
    <>
      <PageHeaderActions>
        <StatusRegion>{statusMessage}</StatusRegion>
      </PageHeaderActions>
      <div className="flex min-h-0 flex-1">
        {isSuccess && (
          <ConnectorTypeNav
            groups={groups}
            notImplemented={notImplemented}
            selectedType={selectedType}
          />
        )}
        <div className="min-w-0 flex-1 overflow-y-auto p-8">
          {/* Gated like the nav above: an unread or failed list has no selected group, and the
              empty branch would report "none configurable" as fact. The header carries status. */}
          {isSuccess && (
            <ConnectorList
              type={selectedGroup?.type}
              label={selectedGroup?.label}
              cards={selectedGroup?.cards ?? []}
              emptyMessage="No connectors are configurable."
            />
          )}
        </div>
      </div>
    </>
  );
}
