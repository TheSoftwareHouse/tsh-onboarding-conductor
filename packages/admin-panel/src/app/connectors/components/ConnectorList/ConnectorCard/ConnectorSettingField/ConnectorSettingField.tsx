import type { ReactElement } from 'react';
import type { Control, UseControllerProps } from 'react-hook-form';
import { Chip } from '@/components/ui/Chip/Chip';
import { SecretFormField } from '@/components/ui/form/SecretFormField/SecretFormField';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { Typography } from '@/components/ui/Typography/Typography';
import type { ConnectorSetting } from '../../../../types/connector';
import {
  describeConnectorSettingsIssue,
  type ConnectorSettingsFormValues,
} from '../../../../utils/connector-settings-form';

export interface ConnectorSettingFieldProps {
  /** Scopes the input's id to its connector, so two cards never collide on the same setting key. */
  idPrefix: string;
  setting: ConnectorSetting;
  control: Control<ConnectorSettingsFormValues>;
  disabled: boolean;
}

/** Stands in for the value the engine withholds; a fixed width, never the real length. */
const STORED_SECRET_MASK = '••••••••••••';

/**
 * Maps one `ConnectorSetting` onto `SecretFormField` or `TextFormField`, filling their slots with
 * the connectors-specific chrome: `isRequired`, the `secret` badge, the `stored`/`Not set` hint
 * and the enforcement `rules`. A secret's box starts empty whatever its `source`, since the engine
 * never returns a stored value.
 */
export function ConnectorSettingField({
  idPrefix,
  setting,
  control,
  disabled,
}: ConnectorSettingFieldProps): ReactElement {
  const controlId = `${idPrefix}-${setting.key}`;
  const isStored = setting.source === 'stored';

  const badges = setting.secret && <Chip tone="neutral-strong">secret</Chip>;

  // ADR 0020: only an *unset* required key is enforced here. The engine judges `required` against
  // the merged result, and a stored secret's box is always empty — enforcing that would block
  // editing an already-configured connector.
  const rules: UseControllerProps<ConnectorSettingsFormValues>['rules'] =
    setting.required && setting.source === 'unset'
      ? {
          validate: (value: string) =>
            value.trim().length > 0 || describeConnectorSettingsIssue('missing_required_key'),
        }
      : undefined;

  const trailing = isStored ? (
    <Chip tone="info">stored</Chip>
  ) : (
    <Typography variant="meta">Not set</Typography>
  );

  return setting.secret ? (
    <SecretFormField
      control={control}
      name={setting.key}
      controlId={controlId}
      label={setting.key}
      isRequired={setting.required}
      revealLabel={setting.key}
      badges={badges}
      trailing={trailing}
      placeholder={isStored ? STORED_SECRET_MASK : undefined}
      disabled={disabled}
      rules={rules}
    />
  ) : (
    <TextFormField
      control={control}
      name={setting.key}
      controlId={controlId}
      label={setting.key}
      isRequired={setting.required}
      badges={badges}
      trailing={trailing}
      font="mono"
      disabled={disabled}
      rules={rules}
    />
  );
}
