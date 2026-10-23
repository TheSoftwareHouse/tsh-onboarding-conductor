import { resolve } from 'node:path';

import { findRepoRoot, validateConfig } from './app.config';

const valid = {
  ENGINE_BASE_URL: 'http://engine:3000',
  ENGINE_REQUEST_TIMEOUT_MS: '60000',
  DEMO_BFF_PORT: '3100',
  DEMO_WEB_ORIGIN: 'http://localhost:5173',
  BNPL_WORKFLOW_ID: 'uk-bnpl-credit-check-algoan',
  UPLOAD_PUBLIC_HOST: 'http://localhost:3900',
  PERSONAS_DIR: '/app/packages/demo-bff/personas',
};

describe('validateConfig', () => {
  it('accepts a complete environment and coerces numbers', () => {
    const config = validateConfig(valid);

    expect(config.DEMO_BFF_PORT).toBe(3100);
    expect(config.ENGINE_REQUEST_TIMEOUT_MS).toBe(60000);
    expect(config.ENGINE_BASE_URL).toBe('http://engine:3000');
  });

  it.each(Object.keys(valid))('fails when %s is missing', (key) => {
    const rest: Record<string, string> = { ...valid };
    delete rest[key];

    expect(() => validateConfig(rest)).toThrow(key);
  });

  it('keeps an absolute PERSONAS_DIR and resolves a relative one against the repository root', () => {
    expect(validateConfig(valid).PERSONAS_DIR).toBe('/app/packages/demo-bff/personas');

    const relative = validateConfig({ ...valid, PERSONAS_DIR: './packages/demo-bff/personas' });

    expect(relative.PERSONAS_DIR).toBe(resolve(findRepoRoot(), 'packages/demo-bff/personas'));
    expect(findRepoRoot()).toBe(resolve(__dirname, '../../../..'));
  });

  it('defaults to the UK journey and accepts the KSA one with its Lean settings', () => {
    expect(validateConfig(valid).BNPL_JOURNEY).toBe('uk-algoan');

    const ksa = validateConfig({
      ...valid,
      BNPL_JOURNEY: 'ksa-lean-algoan',
      LEAN_CLIENT_ID: 'app-token',
      LEAN_CLIENT_SECRET: 'secret',
      LEAN_AUTH_BASE_URL: 'https://auth.sandbox.sa.leantech.me',
      LEAN_API_BASE_URL: 'https://sandbox.sa.leantech.me',
      DEMO_WEB_PUBLIC_ORIGIN: 'https://demo.example.ngrok-free.dev',
    });

    expect(ksa.BNPL_JOURNEY).toBe('ksa-lean-algoan');
  });

  it('refuses the KSA journey without the Lean settings, naming them', () => {
    expect(() => validateConfig({ ...valid, BNPL_JOURNEY: 'ksa-lean-algoan' })).toThrow(
      'LEAN_CLIENT_ID, LEAN_CLIENT_SECRET, LEAN_AUTH_BASE_URL, LEAN_API_BASE_URL, DEMO_WEB_PUBLIC_ORIGIN',
    );
    expect(() => validateConfig({ ...valid, BNPL_JOURNEY: 'mars' })).toThrow('BNPL_JOURNEY');
  });

  it('rejects a base URL without a protocol', () => {
    expect(() => validateConfig({ ...valid, ENGINE_BASE_URL: 'engine:3000' })).toThrow(
      'ENGINE_BASE_URL',
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateConfig({ ...valid, DEMO_BFF_PORT: '70000' })).toThrow('DEMO_BFF_PORT');
  });
});
