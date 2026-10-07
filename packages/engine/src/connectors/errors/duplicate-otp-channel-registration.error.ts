export class DuplicateOtpChannelRegistrationError extends Error {
  constructor(channels: string) {
    super(`Duplicate OTP channel registration for channel=${channels}`);
    this.name = 'DuplicateOtpChannelRegistrationError';
  }
}
