import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateLoaderService } from './email-template-loader.service';
import {
  BUILT_IN_EMAIL_TEMPLATES_DIR,
  DEFAULT_USER_EMAIL_TEMPLATES_DIR,
  EMAIL_TEMPLATES_ROOT,
  FIXTURE_EMAIL_TEMPLATES_DIR,
} from './email-template-roots';
import { EmailTemplatePathInvalidError } from './errors/email-template-path-invalid.error';
import { EmailTemplateReadError } from './errors/email-template-read.error';

const createLoader = (overrides: Record<string, unknown> = {}) =>
  new EmailTemplateLoaderService({
    get: jest.fn((key: string) => overrides[key]),
  } as unknown as ConfigService);

describe('EmailTemplateLoaderService', () => {
  let usersDir: string;

  beforeEach(() => {
    usersDir = mkdtempSync(join(tmpdir(), 'engine-user-email-templates-'));
  });

  afterEach(() => {
    rmSync(usersDir, { recursive: true, force: true });
  });

  it('keeps the built-in and fixture scopes under the shipped email-templates root', () => {
    expect(BUILT_IN_EMAIL_TEMPLATES_DIR).toBe(join(EMAIL_TEMPLATES_ROOT, 'built-in'));
    expect(FIXTURE_EMAIL_TEMPLATES_DIR).toBe(join(EMAIL_TEMPLATES_ROOT, 'fixtures'));
    expect(DEFAULT_USER_EMAIL_TEMPLATES_DIR).toBe(join(EMAIL_TEMPLATES_ROOT, 'users'));
  });

  it('loads a shipped fixture template', () => {
    expect(createLoader().load('fixtures/manual-smtp.html')).toContain('{{firstName}}');
  });

  it('loads a user template from the configured directory', () => {
    writeFileSync(join(usersDir, 'welcome.html'), '<p>Welcome {{firstName}}</p>', 'utf8');

    expect(createLoader({ EMAIL_TEMPLATES_USERS_DIR: usersDir }).load('users/welcome.html')).toBe(
      '<p>Welcome {{firstName}}</p>',
    );
  });

  it('loads a user template from a nested directory', () => {
    mkdirSync(join(usersDir, 'onboarding'));
    writeFileSync(join(usersDir, 'onboarding', 'welcome.html'), '<p>Nested</p>', 'utf8');

    expect(
      createLoader({ EMAIL_TEMPLATES_USERS_DIR: usersDir }).load('users/onboarding/welcome.html'),
    ).toBe('<p>Nested</p>');
  });

  it('falls back to the default user directory when none is configured', () => {
    expect(() => createLoader().load('users/missing.html')).toThrow(EmailTemplateReadError);
    expect(() => createLoader().load('users/missing.html')).toThrow(
      DEFAULT_USER_EMAIL_TEMPLATES_DIR,
    );
  });

  it.each([
    ['blank path', '   '],
    ['missing scope prefix', 'manual-smtp.html'],
    ['unknown scope', 'partials/manual-smtp.html'],
    ['missing file name', 'fixtures/'],
    ['absolute path', '/etc/passwd'],
  ])('rejects a %s', (_caseName, templatePath) => {
    expect(() => createLoader().load(templatePath)).toThrow(EmailTemplatePathInvalidError);
  });

  it.each([
    ['parent traversal', 'fixtures/../../package.json'],
    ['nested traversal', 'users/onboarding/../../escaped.html'],
    ['scope root itself', 'fixtures/.'],
  ])('rejects %s that escapes the scope directory', (_caseName, templatePath) => {
    expect(() => createLoader({ EMAIL_TEMPLATES_USERS_DIR: usersDir }).load(templatePath)).toThrow(
      EmailTemplatePathInvalidError,
    );
  });

  it('does not let the user scope reach the built-in scope', () => {
    expect(() =>
      createLoader({ EMAIL_TEMPLATES_USERS_DIR: usersDir }).load('users/../built-in/anything.html'),
    ).toThrow(EmailTemplatePathInvalidError);
  });

  it('reports the resolved path when a template is missing', () => {
    expect(() =>
      createLoader({ EMAIL_TEMPLATES_USERS_DIR: usersDir }).load('users/absent.html'),
    ).toThrow(join(usersDir, 'absent.html'));
  });
});
