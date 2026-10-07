import type { OtpChannelName } from '@tsh/ddl-schema';
import type { ConnectorSettingDefinition } from './connector-adapter.port';

/** One way of delivering a one-time code, owned by the `otp` connector. */
export interface OtpChannel {
  readonly channel: OtpChannelName;
  /** Settings this channel reads from the `otp` connector's row; all `required: false`. */
  readonly settingsFields: readonly ConnectorSettingDefinition[];
  /** Delivers `code`, or throws OtpDeliveryFailedException / ConnectorNotConfiguredException. */
  send(recipient: string, code: string): Promise<void>;
}

export const OTP_CHANNEL_COLLECTION = Symbol('OTP_CHANNEL_COLLECTION');

export type OtpChannelCollection = readonly OtpChannel[];
