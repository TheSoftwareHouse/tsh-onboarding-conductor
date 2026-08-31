import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigService } from '@nestjs/config';

import { findAdminPanelDist, isApiRequest } from './admin-panel-static';

function createConfigService(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

function createDistDir(withIndex: boolean): string {
  const distDir = join(mkdtempSync(join(tmpdir(), 'admin-panel-static-')), 'dist');
  mkdirSync(distDir);

  if (withIndex) {
    writeFileSync(join(distDir, 'index.html'), '<!doctype html>');
  }

  return distDir;
}

describe('findAdminPanelDist', () => {
  it('serves the configured directory when it holds a build', () => {
    const distDir = createDistDir(true);

    expect(findAdminPanelDist(createConfigService({ ADMIN_PANEL_DIST_DIR: distDir }))).toBe(
      distDir,
    );
  });

  it('ignores surrounding whitespace in the configured path', () => {
    const distDir = createDistDir(true);

    expect(findAdminPanelDist(createConfigService({ ADMIN_PANEL_DIST_DIR: ` ${distDir} ` }))).toBe(
      distDir,
    );
  });

  it('serves nothing when the directory holds no index.html', () => {
    const distDir = createDistDir(false);

    expect(
      findAdminPanelDist(createConfigService({ ADMIN_PANEL_DIST_DIR: distDir })),
    ).toBeUndefined();
  });

  it('serves nothing when the directory does not exist', () => {
    expect(
      findAdminPanelDist(createConfigService({ ADMIN_PANEL_DIST_DIR: '/nonexistent/admin-panel' })),
    ).toBeUndefined();
  });
});

describe('isApiRequest', () => {
  it('recognises the engine routes the panel must never shadow', () => {
    for (const url of [
      '/v1',
      '/v1/health/live',
      '/v1/onboardings',
      '/v1/admin/audit?page=2',
      '/v1/webhooks/twilio_verify',
    ]) {
      expect(isApiRequest({ originalUrl: url, url })).toBe(true);
    }
  });

  it('treats panel routes and assets as the panel’s own', () => {
    for (const url of ['/', '/audit', '/workflows/base', '/assets/index-abc123.js', '/v1beta']) {
      expect(isApiRequest({ originalUrl: url, url })).toBe(false);
    }
  });
});
