import type { ConnectorSetting, ConnectorSettingsIssueReason } from '../types/connector';

/** One `useForm`'s values, keyed by setting name. */
export type ConnectorSettingsFormValues = Record<string, string>;

/** Seeds `defaultValues`: a non-secret stored value prefills; a secret's box starts empty. */
export function buildConnectorSettingsDefaults(
  settings: ConnectorSetting[],
): ConnectorSettingsFormValues {
  const defaults: ConnectorSettingsFormValues = {};

  for (const setting of settings) {
    defaults[setting.key] = setting.secret ? '' : (setting.value ?? '');
  }

  return defaults;
}

/**
 * Post-write reset: a secret box always returns to empty, a non-secret to the trimmed value just
 * sent. An empty `values` blanks every field — what a successful Clear resets to.
 */
export function buildConnectorSettingsResetValues(
  values: Partial<ConnectorSettingsFormValues>,
  settings: ConnectorSetting[],
): ConnectorSettingsFormValues {
  const resetValues: ConnectorSettingsFormValues = {};

  for (const setting of settings) {
    resetValues[setting.key] = setting.secret ? '' : (values[setting.key] ?? '').trim();
  }

  return resetValues;
}

/**
 * The `PATCH` changes map (ADR 0002): keys whose trimmed value differs from their default.
 * Emptying a stored non-secret deletes it (`null`); emptying a secret or unset field is omitted.
 */
export function buildConnectorSettingsChanges(
  values: Partial<ConnectorSettingsFormValues>,
  defaultValues: Partial<ConnectorSettingsFormValues>,
  settings: ConnectorSetting[],
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};

  for (const setting of settings) {
    const value = (values[setting.key] ?? '').trim();
    const defaultValue = (defaultValues[setting.key] ?? '').trim();

    if (value === defaultValue) {
      continue;
    }

    if (value.length > 0) {
      changes[setting.key] = value;
    } else if (!setting.secret && setting.source === 'stored') {
      changes[setting.key] = null;
    }
  }

  return changes;
}

/** Whether the form describes at least one change worth sending to the merge route. */
export function hasConnectorSettingsChanges(
  values: Partial<ConnectorSettingsFormValues>,
  defaultValues: Partial<ConnectorSettingsFormValues>,
  settings: ConnectorSetting[],
): boolean {
  return Object.keys(buildConnectorSettingsChanges(values, defaultValues, settings)).length > 0;
}

/** Operator-facing sentence per engine issue reason; the response already names the key. */
const CONNECTOR_SETTINGS_ISSUE_MESSAGES: Record<ConnectorSettingsIssueReason, string> = {
  undeclared_key: 'This connector does not accept this key.',
  missing_required_key: 'This setting is required.',
  invalid_value: 'Enter a value for this setting.',
  invalid_format: 'This value does not match the expected format.',
  missing_pairing: 'This setting must be provided together with its paired setting, or not at all.',
  // Unreachable — the engine's `PUT` reason — but kept so the map stays exhaustive.
  would_be_dropped: 'This save would have removed a stored setting that it did not include.',
};

export function describeConnectorSettingsIssue(reason: ConnectorSettingsIssueReason): string {
  return CONNECTOR_SETTINGS_ISSUE_MESSAGES[reason];
}
