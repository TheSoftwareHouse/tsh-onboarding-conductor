import { ServiceUnavailableException } from '@nestjs/common';

/**
 * A required credential resolved nowhere — no stored value — at execution time.
 * Distinguishable from a provider outage: this is an operator's gap, not a failed
 * call to a third party.
 */
export class ConnectorNotConfiguredException extends ServiceUnavailableException {
  constructor(connectorType: string, key: string) {
    super({
      code: 'CONNECTOR_NOT_CONFIGURED',
      message: `CONNECTOR_NOT_CONFIGURED: no value resolves for ${connectorType}.${key}`,
      connectorType,
      key,
    });
  }
}
