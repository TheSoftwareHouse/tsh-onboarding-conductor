import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { type ConnectorType } from '@tsh/ddl-schema';
import { CONNECTOR_SCOPE_ENUM, CONNECTOR_TYPE_ENUM } from '../../openapi/api-enums';
import type { ConnectorScope } from '../connector-adapter-scope';
import type {
  ConnectorSettingSource,
  ConnectorSettingsView,
  ConnectorSettingView,
} from '../connector-settings-admin.service';

const CONNECTOR_SETTING_SOURCES = [
  'stored',
  'unset',
] as const satisfies readonly ConnectorSettingSource[];

export class ConnectorSettingResponseDto {
  @ApiProperty({ description: 'The setting key, as the adapter declares it.', example: 'apiKey' })
  key!: string;

  @ApiProperty({
    description:
      "Whether the value is a secret. A secret's value never leaves the engine: the response says " +
      'that it is set, not what it is.',
  })
  secret!: boolean;

  @ApiProperty({ description: 'Whether the connector cannot run without this key.' })
  required!: boolean;

  @ApiProperty({
    enum: [...CONNECTOR_SETTING_SOURCES],
    description: '`stored` when an operator has set the key; `unset` when nothing resolves.',
  })
  source!: ConnectorSettingSource;

  @ApiPropertyOptional({ description: 'Present only when `secret` is false and the key is set.' })
  value?: string;
}

export class ConnectorSettingsResponseDto {
  @ApiProperty({ description: "The connector's own identifier.", example: 'twilio_sms_otp' })
  id!: string;

  @ApiProperty({
    ...CONNECTOR_TYPE_ENUM,
    description: "The capability class, drawn from the same set a workflow's connector `type` is.",
  })
  type!: ConnectorType;

  @ApiProperty({
    ...CONNECTOR_SCOPE_ENUM,
    description:
      'Which group registered the adapter: `built-in` ships with the engine and is always ' +
      'available; `fixtures` is a mock used for demos and tests, never a production integration; ' +
      '`users` was added by this deployment.',
  })
  scope!: ConnectorScope;

  @ApiProperty({ example: 'Twilio Verify' })
  name!: string;

  @ApiProperty({ description: 'True when every required key resolves to a value.' })
  configured!: boolean;

  @ApiProperty({ type: () => ConnectorSettingResponseDto, isArray: true })
  settings!: ConnectorSettingResponseDto[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When an operator last wrote the settings; null when nothing was ever stored.',
  })
  updatedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The operator who last wrote the settings, as the bearer token identified them.',
  })
  updatedBy!: string | null;
}

export class ConnectorSettingsListResponseDto {
  @ApiProperty({ type: () => ConnectorSettingsResponseDto, isArray: true })
  connectors!: ConnectorSettingsResponseDto[];
}

function toConnectorSettingResponse(setting: ConnectorSettingView): ConnectorSettingResponseDto {
  return {
    key: setting.key,
    secret: setting.secret,
    required: setting.required,
    source: setting.source,
    value: setting.value,
  };
}

/** The service returns `updatedAt` as a `Date`; this is the one place it becomes ISO text. */
export function toConnectorSettingsResponse(
  view: ConnectorSettingsView,
): ConnectorSettingsResponseDto {
  return {
    id: view.id,
    type: view.type,
    scope: view.scope,
    name: view.name,
    configured: view.configured,
    settings: view.settings.map(toConnectorSettingResponse),
    updatedAt: view.updatedAt === null ? null : view.updatedAt.toISOString(),
    updatedBy: view.updatedBy,
  };
}
