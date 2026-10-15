import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_BFF_BASE_URL, getBffBaseUrl } from './runtime-env';

describe('getBffBaseUrl', () => {
  afterEach(() => {
    delete window.__ENV__;
  });

  it('should fall back to the local BFF when nothing is configured', () => {
    expect(getBffBaseUrl()).toBe(DEFAULT_BFF_BASE_URL);
  });

  it('should prefer the runtime value and drop a trailing slash', () => {
    window.__ENV__ = { VITE_BNPL_BFF_BASE_URL: 'https://bff.example.test/' };

    expect(getBffBaseUrl()).toBe('https://bff.example.test');
  });

  it('should ignore an empty runtime value', () => {
    window.__ENV__ = { VITE_BNPL_BFF_BASE_URL: '' };

    expect(getBffBaseUrl()).toBe(DEFAULT_BFF_BASE_URL);
  });
});
