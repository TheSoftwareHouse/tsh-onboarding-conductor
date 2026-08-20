import { readFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BUILT_IN_EMAIL_TEMPLATES_DIR,
  DEFAULT_USER_EMAIL_TEMPLATES_DIR,
  FIXTURE_EMAIL_TEMPLATES_DIR,
} from './email-template-roots';
import { isEmailTemplateScope, type EmailTemplateScope } from './email-template-scope';
import { EmailTemplatePathInvalidError } from './errors/email-template-path-invalid.error';
import { EmailTemplateReadError } from './errors/email-template-read.error';

@Injectable()
export class EmailTemplateLoaderService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Loads a scope-prefixed template, for example `fixtures/manual-smtp.html`.
   * Built-in and fixture scopes always resolve inside the shipped
   * `email-templates/` directory; the user scope follows
   * `EMAIL_TEMPLATES_USERS_DIR` when set.
   */
  load(templatePath: string): string {
    const resolvedPath = this.resolvePath(templatePath);

    try {
      return readFileSync(resolvedPath, 'utf8');
    } catch (error) {
      throw new EmailTemplateReadError(
        templatePath,
        resolvedPath,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private resolvePath(templatePath: string): string {
    const trimmedPath = templatePath.trim();

    if (trimmedPath.length === 0) {
      throw new EmailTemplatePathInvalidError(templatePath, 'path is empty');
    }

    if (isAbsolute(trimmedPath)) {
      throw new EmailTemplatePathInvalidError(templatePath, 'absolute paths are not allowed');
    }

    const separatorIndex = trimmedPath.replace(/\\/g, '/').indexOf('/');
    if (separatorIndex < 0) {
      throw new EmailTemplatePathInvalidError(templatePath, 'path is missing a scope prefix');
    }

    const scope = trimmedPath.slice(0, separatorIndex);
    const relativePath = trimmedPath.slice(separatorIndex + 1);

    if (!isEmailTemplateScope(scope)) {
      throw new EmailTemplatePathInvalidError(templatePath, `unknown scope "${scope}"`);
    }

    if (relativePath.trim().length === 0) {
      throw new EmailTemplatePathInvalidError(templatePath, 'path is missing a file name');
    }

    const scopeRoot = this.getScopeRoot(scope);
    const resolvedPath = resolve(scopeRoot, relativePath);

    if (!this.isContainedIn(scopeRoot, resolvedPath)) {
      throw new EmailTemplatePathInvalidError(
        templatePath,
        `path escapes the "${scope}" template directory`,
      );
    }

    return resolvedPath;
  }

  private getScopeRoot(scope: EmailTemplateScope): string {
    switch (scope) {
      case 'built-in':
        return BUILT_IN_EMAIL_TEMPLATES_DIR;
      case 'fixtures':
        return FIXTURE_EMAIL_TEMPLATES_DIR;
      case 'users':
        return this.getUserTemplatesDir();
    }
  }

  private getUserTemplatesDir(): string {
    const configuredDir = this.configService.get<string>('EMAIL_TEMPLATES_USERS_DIR');

    if (typeof configuredDir === 'string' && configuredDir.trim().length > 0) {
      return resolve(configuredDir.trim());
    }

    return DEFAULT_USER_EMAIL_TEMPLATES_DIR;
  }

  private isContainedIn(root: string, candidate: string): boolean {
    const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
    return candidate.startsWith(normalizedRoot);
  }
}
