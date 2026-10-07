/** An `otp` connector declaration names an operation or channel the connector cannot serve. */
export class OtpDeclarationInvalidError extends Error {
  constructor(field: 'operation' | 'channel', value: unknown) {
    super(`Invalid otp connector declaration: config.${field}=${String(value)} is not supported`);
    this.name = 'OtpDeclarationInvalidError';
  }
}
