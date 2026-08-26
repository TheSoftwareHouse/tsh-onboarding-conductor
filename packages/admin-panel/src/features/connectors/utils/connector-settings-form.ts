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

/** A key/value row the operator is adding, only offered when the connector allows extra keys. */
export interface ConnectorCustomKeyDraft {
  name: string;
  value: string;
}

/**
 * One connector's settings as the operator is editing them. This is no longer the
 * connector's complete desired state — it is a form for describing a change, so
 * `removedKeys` remembers a field dropped entirely via "Remove key" (see
 * `ConnectorCardProps.onRemoveField`); once gone from `fields`, only this list still
 * says the key must be deleted rather than simply left untouched.
 */
export interface ConnectorSettingsDraft {
  fields: ConnectorSettingDraft[];
  customKeys: ConnectorCustomKeyDraft[];
  removedKeys: string[];
}

/**
 * Seeds a draft from a connector's current settings. `connector.settings` already
 * arrives in schema order followed by any stored additional keys (see `buildView` in
 * `connector-settings-admin.service.ts`), so no reordering happens here. A non-secret
 * stored value prefills its input; a secret's value never arrives from the engine, so
 * its input — and any unset input — starts empty. `initialValue` is seeded to the same
 * starting value so a later edit can be compared back against it.
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

  return { fields, customKeys: [], removedKeys: [] };
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

  for (const key of draft.removedKeys) {
    changes[key] = null;
  }

  for (const customKey of draft.customKeys) {
    const name = customKey.name.trim();
    const value = customKey.value.trim();

    if (name.length > 0 && value.length > 0) {
      changes[name] = value;
    }
  }

  return changes;
}

/** Whether the draft describes at least one change worth sending to the merge route. */
export function hasConnectorSettingsChanges(draft: ConnectorSettingsDraft): boolean {
  return Object.keys(buildConnectorSettingsChanges(draft)).length > 0;
}

/**
 * Refuses submission when there is nothing to send, or when a custom key row is not
 * yet a valid entry: named but valueless, reusing a name already entered in another
 * custom row, or reusing a name that already names one of the connector's own declared
 * fields — that collision would otherwise reach `buildConnectorSettingsChanges` and
 * silently overwrite the declared field's value instead of adding a new key. An
 * untouched "Add key" row — no name, no value — never blocks Save.
 */
export function canSubmitConnectorSettings(draft: ConnectorSettingsDraft): boolean {
  if (!hasConnectorSettingsChanges(draft)) {
    return false;
  }

  const fieldKeys = new Set(draft.fields.map((field) => field.key));
  const names = new Set<string>();

  for (const customKey of draft.customKeys) {
    const name = customKey.name.trim();

    if (name.length === 0) {
      continue;
    }

    if (customKey.value.trim().length === 0 || names.has(name) || fieldKeys.has(name)) {
      return false;
    }

    names.add(name);
  }

  return true;
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
