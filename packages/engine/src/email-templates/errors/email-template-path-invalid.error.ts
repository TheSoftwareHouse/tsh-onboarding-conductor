import { EMAIL_TEMPLATE_SCOPES } from '../email-template-scope';

export class EmailTemplatePathInvalidError extends Error {
  constructor(
    public readonly templatePath: string,
    reason: string,
  ) {
    super(
      `Invalid email template path "${templatePath}": ${reason}. ` +
        `Expected "<scope>/<file>" where scope is one of: ${EMAIL_TEMPLATE_SCOPES.join(', ')}.`,
    );
    this.name = 'EmailTemplatePathInvalidError';
  }
}
