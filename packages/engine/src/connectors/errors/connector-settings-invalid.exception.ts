import { BadRequestException } from '@nestjs/common';

export type ConnectorSettingsInvalidReason =
  | 'undeclared_key'
  | 'missing_required_key'
  | 'invalid_value'
  | 'invalid_format'
  | 'missing_pairing'
  | 'would_be_dropped';

export type ConnectorSettingsInvalidIssue = Readonly<{
  key: string;
  reason: ConnectorSettingsInvalidReason;
}>;

/**
 * Raised once per rejected write, naming every offending key at once rather than
 * failing on the first one found.
 */
export class ConnectorSettingsInvalidException extends BadRequestException {
  constructor(issues: readonly ConnectorSettingsInvalidIssue[]) {
    super({
      code: 'CONNECTOR_SETTINGS_INVALID',
      message: 'CONNECTOR_SETTINGS_INVALID',
      issues,
    });
  }
}
