/** An OTP connector declaration names an operation, or a channel, the connector cannot serve. */
export class OtpDeclarationInvalidError extends Error {
  constructor(connectorId: string, field: 'operation' | 'channel', value: unknown) {
    super(
      `Invalid ${connectorId} connector declaration: config.${field}=${String(value)} is not supported`,
    );
    this.name = 'OtpDeclarationInvalidError';
  }
}
