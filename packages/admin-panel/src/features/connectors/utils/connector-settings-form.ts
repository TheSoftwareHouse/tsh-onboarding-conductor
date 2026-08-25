import type { Connector, ConnectorSettingsIssueReason } from '../types/connector';

/**
 * One setting's draft input. Mirrors `ConnectorSetting`'s metadata so the submit guard
 * and the field renderer can both read `secret`/`required`/`source` without looking the
 * key back up on the connector, plus the operator-entered `value` the connector itself
 * never carries for a secret.
 */
export interface ConnectorSettingDraft {
  key: string;
  secret: boolean;
  required: boolean;
  source: 'stored' | 'unset';
  value: string;
}

/** A key/value row the operator is adding, only offered when the connector allows extra keys. */
export interface ConnectorCustomKeyDraft {
  name: string;
  value: string;
}

/** A connector's complete desired state as the operator is editing it. */
export interface ConnectorSettingsDraft {
  fields: ConnectorSettingDraft[];
  customKeys: ConnectorCustomKeyDraft[];
}

/**
 * Seeds a draft from a connector's current settings. `connector.settings` already
 * arrives in schema order followed by any stored additional keys (see `buildView` in
 * `connector-settings-admin.service.ts`), so no reordering happens here. A non-secret
 * stored value prefills its input; a secret's value never arrives from the engine, so
 * its input — and any unset input — starts empty.
 */
export function createConnectorSettingsDraft(connector: Connector): ConnectorSettingsDraft {
  const fields = connector.settings.map((setting) => ({
    key: setting.key,
    secret: setting.secret,
    required: setting.required,
    source: setting.source,
    value: setting.secret ? '' : (setting.value ?? ''),
  }));

  return { fields, customKeys: [] };
}

/**
 * Reduces a draft to the `Record<string, string>` `PUT` payload: the form is the
 * connector's complete desired state, so a blank input is an intentional omission, not
 * a value of `''`. Values are trimmed so incidental whitespace does not become part of
 * a stored credential.
 */
export function buildConnectorSettingsPayload(
  draft: ConnectorSettingsDraft,
): Record<string, string> {
  const payload: Record<string, string> = {};

  for (const field of draft.fields) {
    const value = field.value.trim();

    if (value.length > 0) {
      payload[field.key] = value;
    }
  }

  for (const customKey of draft.customKeys) {
    const name = customKey.name.trim();
    const value = customKey.value.trim();

    if (name.length > 0 && value.length > 0) {
      payload[name] = value;
    }
  }

  return payload;
}

/**
 * Refuses submission whenever `replace=true` would silently drop a credential the
 * operator cannot re-supply (a stored secret left empty), or whenever a custom key row
 * is not yet a valid entry: named but valueless, reusing a name already entered in
 * another custom row, or reusing a name that already names one of the connector's own
 * declared fields — that collision would otherwise reach `buildConnectorSettingsPayload`
 * and silently overwrite the declared field's value instead of adding a new key. An
 * untouched "Add key" row — no name, no value — never blocks Save.
 */
export function canSubmitConnectorSettings(draft: ConnectorSettingsDraft): boolean {
  const hasEmptyStoredSecret = draft.fields.some(
    (field) => field.secret && field.source === 'stored' && field.value.trim().length === 0,
  );

  if (hasEmptyStoredSecret) {
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
  would_be_dropped:
    'This stored setting is missing from the save and would be removed — re-enter it to keep it, or use Clear to remove it intentionally.',
};

export function describeConnectorSettingsIssue(reason: ConnectorSettingsIssueReason): string {
  return CONNECTOR_SETTINGS_ISSUE_MESSAGES[reason];
}
