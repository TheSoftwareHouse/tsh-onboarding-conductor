import type { Connector, ConnectorSettingsIssueReason } from '../types/connector';

/**
 * One setting's draft input. Mirrors `ConnectorSetting`'s metadata so the submit guard
 * and the field renderer can both read `secret`/`required`/`source` without looking the
 * key back up on the connector, plus the operator-entered `value` the connector itself
 * never carries for a secret. `initialValue` is what `value` was seeded to when the
 * draft was created — without it, a merge write cannot tell an untouched, prefilled
 * field from one the operator edited back to the same text, nor a blank stored secret
 * the operator never touched from one they emptied on purpose.
 */
export interface ConnectorSettingDraft {
  key: string;
  secret: boolean;
  required: boolean;
  source: 'stored' | 'unset';
  value: string;
  initialValue: string;
}

/**
 * One connector's settings as the operator is editing them. This is not the connector's
 * complete desired state — it is a form for describing a change, which is why each field
 * carries its own `initialValue` rather than the draft carrying a snapshot of the whole
 * connector.
 */
export interface ConnectorSettingsDraft {
  fields: ConnectorSettingDraft[];
}

/**
 * Seeds a draft from a connector's current settings. `connector.settings` already arrives
 * in schema order (see `buildView` in `connector-settings-admin.service.ts`), so no
 * reordering happens here. A non-secret stored value prefills its input; a secret's value
 * never arrives from the engine, so its input — and any unset input — starts empty.
 * `initialValue` is seeded to the same starting value so a later edit can be compared
 * back against it.
 */
export function createConnectorSettingsDraft(connector: Connector): ConnectorSettingsDraft {
  const fields = connector.settings.map((setting) => {
    const value = setting.secret ? '' : (setting.value ?? '');

    return {
      key: setting.key,
      secret: setting.secret,
      required: setting.required,
      source: setting.source,
      value,
      initialValue: value,
    };
  });

  return { fields };
}

/**
 * The draft a card shows once its stored settings are gone: every declared field back to unset
 * with an empty box.
 *
 * Applied the moment a clear succeeds rather than waiting for the refetched connector to reseed
 * the draft. The reseed still happens and remains authoritative, but it only fires when the list
 * actually changes, and React Query's structural sharing hands back the *same* list when the
 * refetched payload is deeply equal — which is exactly what a clear of an unconfigured connector
 * produces. Leaving the reset to that effect is what left an operator's typed value sitting in a
 * box whose stored value had just been deleted.
 */
export function clearConnectorSettingsDraft(draft: ConnectorSettingsDraft): ConnectorSettingsDraft {
  return {
    fields: draft.fields.map((field) => ({
      ...field,
      source: 'unset',
      value: '',
      initialValue: '',
    })),
  };
}

/**
 * Reduces a draft to the `PATCH` changes map: only the keys the operator actually
 * touched. A field whose trimmed value still matches what it was seeded with is
 * untouched and stays out of the map entirely — this is what lets a blank stored
 * secret survive a save the operator never meant to touch it with. A non-secret field
 * that had a stored value and was emptied is an explicit deletion (`null`); emptying a
 * secret box, or a field that was never stored, is indistinguishable from never having
 * touched it, so it is likewise omitted rather than sent as a deletion. Values are
 * trimmed so incidental whitespace does not become part of a stored credential.
 */
export function buildConnectorSettingsChanges(
  draft: ConnectorSettingsDraft,
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};

  for (const field of draft.fields) {
    const value = field.value.trim();
    const initialValue = field.initialValue.trim();

    if (value === initialValue) {
      continue;
    }

    if (value.length > 0) {
      changes[field.key] = value;
    } else if (!field.secret && field.source === 'stored') {
      changes[field.key] = null;
    }
  }

  return changes;
}

/** Whether the draft describes at least one change worth sending to the merge route. */
export function hasConnectorSettingsChanges(draft: ConnectorSettingsDraft): boolean {
  return Object.keys(buildConnectorSettingsChanges(draft)).length > 0;
}

/** Refuses submission when the draft describes nothing to send. */
export function canSubmitConnectorSettings(draft: ConnectorSettingsDraft): boolean {
  return hasConnectorSettingsChanges(draft);
}

/**
 * Operator-facing sentence for one of the engine's `CONNECTOR_SETTINGS_INVALID` issue
 * reasons, shown under the offending field. The engine's response already names the
 * key, so these sentences describe only the reason, not the field.
 */
const CONNECTOR_SETTINGS_ISSUE_MESSAGES: Record<ConnectorSettingsIssueReason, string> = {
  undeclared_key: 'This connector does not accept this key.',
  missing_required_key: 'This setting is required.',
  invalid_value: 'Enter a value for this setting.',
  invalid_format: 'This value does not match the expected format.',
  missing_pairing: 'This setting must be provided together with its paired setting, or not at all.',
  // Unreachable from the panel: this reason belongs to the engine's wholesale `PUT`, and the
  // panel writes only through `PATCH`, which never drops a key it was not asked to. Kept so
  // the reason map stays exhaustive over the engine's contract rather than over this caller's
  // subset of it — a reason the panel cannot explain is worse than one it never shows.
  would_be_dropped: 'This save would have removed a stored setting that it did not include.',
};

export function describeConnectorSettingsIssue(reason: ConnectorSettingsIssueReason): string {
  return CONNECTOR_SETTINGS_ISSUE_MESSAGES[reason];
}
