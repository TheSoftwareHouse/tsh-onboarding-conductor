import type { ConnectorSetting, ConnectorSettingsIssueReason } from '../types/connector';

/** One `useForm`'s values, keyed by setting name. */
export type ConnectorSettingsFormValues = Record<string, string>;

/**
 * Seeds a form's `defaultValues`. A non-secret stored value prefills its input; a secret's value
 * never arrives from the engine, so its input — and any unset input — starts empty.
 */
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
 * The values a form resets to once a write against `settings` has succeeded. A secret box is
 * always reset to empty — the engine never returns a stored value, so its box cannot show one —
 * while a non-secret box shows the (trimmed) value that was just sent. Passing an empty `values`
 * yields every field blank, which is also what a successful Clear resets to.
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
 * Reduces the form to the `PATCH` changes map (ADR 0002): only keys whose trimmed value differs
 * from their default, so an untouched blank stored secret survives a save never meant to touch it.
 * Emptying a stored *non-secret* is an explicit deletion (`null`); emptying a secret, or a
 * never-stored field, is indistinguishable from not touching it and is omitted instead. Trimming
 * keeps incidental whitespace out of a stored credential.
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
  // Unreachable: this reason belongs to the engine's `PUT` and the panel only `PATCH`es. Kept so
  // the map stays exhaustive over the engine's contract — an unexplainable reason is worse.
  would_be_dropped: 'This save would have removed a stored setting that it did not include.',
};

export function describeConnectorSettingsIssue(reason: ConnectorSettingsIssueReason): string {
  return CONNECTOR_SETTINGS_ISSUE_MESSAGES[reason];
}
