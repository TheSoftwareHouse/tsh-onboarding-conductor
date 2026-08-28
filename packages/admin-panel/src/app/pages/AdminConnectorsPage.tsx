import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  clearConnectorSettingsDraft,
  ConnectorList,
  createConnectorSettingsDraft,
  useConnectors,
  type Connector,
  type ConnectorCardProps,
  type ConnectorSettingsDraft,
  type ConnectorSettingsIssue,
} from '@/features/connectors';

/**
 * Composes the connectors tab from `useConnectors` and `ConnectorList`. The page owns each
 * connector's draft and its last rejected-write issues, because those are per-card editing
 * state the hook — which only knows about the server list and which write is in flight — has
 * no reason to carry.
 */
export function AdminConnectorsPage(): ReactElement {
  const { phase, connectors, error, pendingConnectorId, saveSettings, clearSettings } =
    useConnectors();

  const [drafts, setDrafts] = useState<Record<string, ConnectorSettingsDraft>>({});
  const [issuesById, setIssuesById] = useState<Record<string, ConnectorSettingsIssue[]>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // Marked the moment a save or clear succeeds, and drained the next time `connectors` changes —
  // the refetch that success triggers has not resolved yet, so the fresh settings this card
  // should reset to are not available until this effect runs again with the new list.
  const pendingReseed = useRef<Set<string>>(new Set());
  // Tracks which connectors have been seeded at least once, so the effect below can tell
  // "never seeded" from "already has a draft" without reading `drafts` inside the `setDrafts`
  // updater — `drafts` no longer gates `connectors` in `useConnectors`, so a type already seeded
  // stays seeded across a refetch instead of being re-derived from a momentarily empty list.
  const seededIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const toReseed = connectors.filter(
      (connector) =>
        !seededIds.current.has(connector.id) || pendingReseed.current.has(connector.id),
    );

    if (toReseed.length === 0) {
      return;
    }

    // Pure with respect to `toReseed` and `current`, so StrictMode invoking it twice to check
    // for impurities is harmless — the ref bookkeeping below runs once, outside the updater,
    // for exactly the connectors this pass actually reseeded, never a blanket `clear()`.
    setDrafts((current) => {
      const next = { ...current };

      for (const connector of toReseed) {
        next[connector.id] = createConnectorSettingsDraft(connector);
      }

      return next;
    });

    for (const connector of toReseed) {
      seededIds.current.add(connector.id);
      pendingReseed.current.delete(connector.id);
    }
  }, [connectors]);

  function updateDraft(
    connectorId: string,
    update: (draft: ConnectorSettingsDraft) => ConnectorSettingsDraft,
  ): void {
    setDrafts((current) => {
      const existing = current[connectorId];
      return existing ? { ...current, [connectorId]: update(existing) } : current;
    });
  }

  async function handleSave(
    connector: Connector,
    changes: Record<string, string | null>,
  ): Promise<void> {
    setIssuesById((current) => ({ ...current, [connector.id]: [] }));
    const outcome = await saveSettings(connector.id, changes);

    if (outcome.ok) {
      pendingReseed.current.add(connector.id);
      setActionMessage(`${connector.name} settings saved.`);
    } else {
      setIssuesById((current) => ({ ...current, [connector.id]: outcome.error.issues }));
      setActionMessage(`Unable to save ${connector.name}: ${outcome.error.message}`);
    }
  }

  async function handleClear(connector: Connector): Promise<void> {
    setIssuesById((current) => ({ ...current, [connector.id]: [] }));
    const outcome = await clearSettings(connector.id);

    if (outcome.ok) {
      pendingReseed.current.add(connector.id);
      // Empty the boxes now: what was stored is gone, so anything still typed in the card
      // describes a state that no longer exists. The reseed below stays authoritative, but it
      // cannot be relied on to do this — see `clearConnectorSettingsDraft`.
      updateDraft(connector.id, clearConnectorSettingsDraft);
      setActionMessage(`${connector.name} settings cleared.`);
    } else {
      setActionMessage(`Unable to clear ${connector.name}: ${outcome.error.message}`);
    }
  }

  function buildCard(connector: Connector): ConnectorCardProps {
    const draft = drafts[connector.id] ?? createConnectorSettingsDraft(connector);
    const issues = issuesById[connector.id] ?? [];

    return {
      connector,
      draft,
      issues,
      pending: pendingConnectorId === connector.id,
      onFieldChange: (key, value) =>
        updateDraft(connector.id, (current) => ({
          ...current,
          fields: current.fields.map((field) => (field.key === key ? { ...field, value } : field)),
        })),
      onSave: (settings) => {
        void handleSave(connector, settings);
      },
      onClear: () => {
        void handleClear(connector);
      },
    };
  }

  let statusMessage: string;

  if (phase === 'loading') {
    statusMessage = 'Loading connectors…';
  } else if (phase === 'error') {
    statusMessage = error
      ? `Unable to load connectors: ${error.message}`
      : 'Unable to load connectors.';
  } else {
    statusMessage =
      actionMessage ??
      `Showing ${connectors.length} connector${connectors.length === 1 ? '' : 's'}.`;
  }

  const cards = phase === 'ready' ? connectors.map(buildCard) : [];

  return (
    <ConnectorList
      statusMessage={statusMessage}
      emptyMessage="No connectors are configurable."
      cards={cards}
    />
  );
}
