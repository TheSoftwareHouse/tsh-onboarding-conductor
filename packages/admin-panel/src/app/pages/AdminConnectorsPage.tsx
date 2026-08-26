import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
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
  const { phase, connectors, error, pendingConnectorType, saveSettings, clearSettings } =
    useConnectors();

  const [drafts, setDrafts] = useState<Record<string, ConnectorSettingsDraft>>({});
  const [issuesByType, setIssuesByType] = useState<Record<string, ConnectorSettingsIssue[]>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // Marked the moment a save or clear succeeds, and drained the next time `connectors` changes —
  // the refetch that success triggers has not resolved yet, so the fresh settings this card
  // should reset to are not available until this effect runs again with the new list.
  const pendingReseed = useRef<Set<string>>(new Set());
  // Tracks which connector types have been seeded at least once, so the effect below can tell
  // "never seeded" from "already has a draft" without reading `drafts` inside the `setDrafts`
  // updater — `drafts` no longer gates `connectors` in `useConnectors`, so a type already seeded
  // stays seeded across a refetch instead of being re-derived from a momentarily empty list.
  const seededTypes = useRef<Set<string>>(new Set());

  useEffect(() => {
    const toReseed = connectors.filter(
      (connector) =>
        !seededTypes.current.has(connector.type) || pendingReseed.current.has(connector.type),
    );

    if (toReseed.length === 0) {
      return;
    }

    // Pure with respect to `toReseed` and `current`, so StrictMode invoking it twice to check
    // for impurities is harmless — the ref bookkeeping below runs once, outside the updater,
    // for exactly the connector types this pass actually reseeded, never a blanket `clear()`.
    setDrafts((current) => {
      const next = { ...current };

      for (const connector of toReseed) {
        next[connector.type] = createConnectorSettingsDraft(connector);
      }

      return next;
    });

    for (const connector of toReseed) {
      seededTypes.current.add(connector.type);
      pendingReseed.current.delete(connector.type);
    }
  }, [connectors]);

  function updateDraft(
    connectorType: string,
    update: (draft: ConnectorSettingsDraft) => ConnectorSettingsDraft,
  ): void {
    setDrafts((current) => {
      const existing = current[connectorType];
      return existing ? { ...current, [connectorType]: update(existing) } : current;
    });
  }

  async function handleSave(
    connector: Connector,
    changes: Record<string, string | null>,
  ): Promise<void> {
    setIssuesByType((current) => ({ ...current, [connector.type]: [] }));
    const outcome = await saveSettings(connector.type, changes);

    if (outcome.ok) {
      pendingReseed.current.add(connector.type);
      setActionMessage(`${connector.name} settings saved.`);
    } else {
      setIssuesByType((current) => ({ ...current, [connector.type]: outcome.error.issues }));
      setActionMessage(`Unable to save ${connector.name}: ${outcome.error.message}`);
    }
  }

  async function handleClear(connector: Connector): Promise<void> {
    setIssuesByType((current) => ({ ...current, [connector.type]: [] }));
    const outcome = await clearSettings(connector.type);

    if (outcome.ok) {
      pendingReseed.current.add(connector.type);
      setActionMessage(`${connector.name} settings cleared.`);
    } else {
      setActionMessage(`Unable to clear ${connector.name}: ${outcome.error.message}`);
    }
  }

  function buildCard(connector: Connector): ConnectorCardProps {
    const draft = drafts[connector.type] ?? createConnectorSettingsDraft(connector);
    const issues = issuesByType[connector.type] ?? [];

    return {
      connector,
      draft,
      issues,
      pending: pendingConnectorType === connector.type,
      onFieldChange: (key, value) =>
        updateDraft(connector.type, (current) => ({
          ...current,
          fields: current.fields.map((field) => (field.key === key ? { ...field, value } : field)),
        })),
      onRemoveField: (key) =>
        updateDraft(connector.type, (current) => ({
          ...current,
          fields: current.fields.filter((field) => field.key !== key),
          removedKeys: [...current.removedKeys, key],
        })),
      onAddCustomKey: () =>
        updateDraft(connector.type, (current) => ({
          ...current,
          customKeys: [...current.customKeys, { name: '', value: '' }],
        })),
      onCustomKeyNameChange: (index, name) =>
        updateDraft(connector.type, (current) => ({
          ...current,
          customKeys: current.customKeys.map((key, i) => (i === index ? { ...key, name } : key)),
        })),
      onCustomKeyValueChange: (index, value) =>
        updateDraft(connector.type, (current) => ({
          ...current,
          customKeys: current.customKeys.map((key, i) => (i === index ? { ...key, value } : key)),
        })),
      onRemoveCustomKey: (index) =>
        updateDraft(connector.type, (current) => ({
          ...current,
          customKeys: current.customKeys.filter((_, i) => i !== index),
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
