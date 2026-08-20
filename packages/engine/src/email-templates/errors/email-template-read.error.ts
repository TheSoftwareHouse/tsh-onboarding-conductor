export class EmailTemplateReadError extends Error {
  constructor(
    public readonly templatePath: string,
    public readonly resolvedPath: string,
    cause?: Error,
  ) {
    const errorMessage = cause ? `: ${cause.message}` : '';
    super(`Cannot read email template "${templatePath}" from ${resolvedPath}${errorMessage}`);
    this.name = 'EmailTemplateReadError';
  }
}
