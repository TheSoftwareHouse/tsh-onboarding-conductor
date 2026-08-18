export const EMAIL_TEMPLATE_SCOPES = ['built-in', 'fixtures', 'users'] as const;

export type EmailTemplateScope = (typeof EMAIL_TEMPLATE_SCOPES)[number];

export const isEmailTemplateScope = (value: string): value is EmailTemplateScope =>
  (EMAIL_TEMPLATE_SCOPES as readonly string[]).includes(value);
