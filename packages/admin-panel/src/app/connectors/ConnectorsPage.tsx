import type { ReactElement } from 'react';
import { useQueryStates } from 'nuqs';
import type { Connector } from '@/api/connectors/connectors';
import type { AdminPageProps } from '@/lib/admin-page';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ConnectorList } from './components/ConnectorList/ConnectorList';
import { ConnectorTypeNav } from './components/ConnectorTypeNav/ConnectorTypeNav';
import { groupConnectorsByType } from './components/ConnectorList/group-connectors-by-type';
import type { ConnectorCardProps } from './components/ConnectorList/ConnectorCard/ConnectorCard';
import { useConnectors, type ConnectorWriteOutcome } from './hooks/useConnectors';
import {
  connectorsSearchParams,
  findSelectedConnectorType,
} from './utils/connectors-search-params';

const EMPTY_TITLE = 'No connectors are configurable';
const EMPTY_BODY = 'The engine discovered no connector adapters when it started.';

/**
 * Composes the connectors tab from `useConnectors`, the `?type=` nav and `ConnectorList`. Each
 * card owns its own form and draft — this page only wires the write callbacks and the message
 * they report through.
 */
export function ConnectorsPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { isPending, isSuccess, connectors, error, refetch, saveSettings, clearSettings } =
    useConnectors();
  // `type` is read only — the nav commits it by linking straight to `?type=`, the same pattern
  // `AuditResourceTabs` uses. `shallow: false` still matters here: without it a commit never
  // reaches react-router, and `AdminLayout`'s remembered per-section search goes stale.
  const [{ type: requestedType }] = useQueryStates(connectorsSearchParams, { shallow: false });

  async function handleSave(
    connector: Connector,
    changes: Record<string, string | null>,
  ): Promise<ConnectorWriteOutcome> {
    const outcome = await saveSettings(connector.id, changes);

    if (outcome.ok) {
      showSuccessToast(`${connector.name} settings saved.`);
    } else {
      showErrorToast(`Unable to save ${connector.name}:`, outcome.error.message);
    }

    return outcome;
  }

  async function handleClear(connector: Connector): Promise<ConnectorWriteOutcome> {
    const outcome = await clearSettings(connector.id);

    if (outcome.ok) {
      showSuccessToast(`${connector.name} settings cleared.`);
    } else {
      showErrorToast(`Unable to clear ${connector.name}:`, outcome.error.message);
    }

    return outcome;
  }

  function buildCard(connector: Connector): ConnectorCardProps {
    return {
      connector,
      onSave: (changes) => handleSave(connector, changes),
      onClear: () => handleClear(connector),
    };
  }

  const configuredCount = connectors.filter((connector) => connector.configured).length;
  const statusMessage = `${connectors.length} adapter${connectors.length === 1 ? '' : 's'} discovered · ${configuredCount} configured`;

  const cards = isSuccess ? connectors.map(buildCard) : [];
  const { groups, notImplemented } = groupConnectorsByType(cards);
  const selectedType = findSelectedConnectorType(
    groups.map((group) => group.type),
    requestedType,
  );
  const selectedGroup = groups.find((group) => group.type === selectedType);

  let body: ReactElement;

  if (isPending) {
    body = <Loader label="Loading connectors…" />;
  } else if (!isSuccess) {
    body = <LoadFailure error={error} subject="connectors" onRetry={refetch} />;
  } else if (selectedGroup) {
    body = (
      <ConnectorList
        type={selectedGroup.type}
        label={selectedGroup.label}
        cards={selectedGroup.cards}
      />
    );
  } else {
    body = <EmptyState title={EMPTY_TITLE} body={EMPTY_BODY} />;
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        {isSuccess && <StatusRegion>{statusMessage}</StatusRegion>}
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        {isSuccess && (
          <ConnectorTypeNav
            groups={groups}
            notImplemented={notImplemented}
            selectedType={selectedType}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-8">{body}</div>
      </div>
    </>
  );
}
