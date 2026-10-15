import { describe, expect, it } from 'vitest';

import type { SessionView } from '@/api/bnpl/bnpl.client';

import { isPageFor, pageFor, sessionPath, stepPath } from './session-routes';

function view(overrides: Partial<SessionView>): SessionView {
  return { phase: 'collect', step: null, fields: [], data: {}, persona: null, ...overrides };
}

describe('session routes', () => {
  it.each([
    ['applicant', 'details'],
    ['credit_consent', 'consent'],
    ['bank_selection', 'bank'],
    ['bank_connection', 'bank/auth'],
    ['account_selection', 'accounts'],
    ['bank_access_consent', 'bank/consent'],
    ['credit_check', 'bank/consent'],
  ] as const)('should map the %s step to %s', (step, page) => {
    expect(stepPath(step)).toBe(page);
    expect(pageFor(view({ step }))).toBe(page);
  });

  it('should send processing and result phases to their pages', () => {
    expect(pageFor(view({ phase: 'processing' }))).toBe('processing');
    expect(pageFor(view({ phase: 'result', step: null }))).toBe('result');
  });

  it('should send a retry to the accounts page', () => {
    expect(pageFor(view({ step: 'account_selection', retry: true }))).toBe('accounts');
  });

  it('should allow every bank connection page while connecting', () => {
    for (const page of ['bank/auth', 'bank/login', 'bank/transfer'] as const) {
      expect(isPageFor(view({ step: 'bank_connection' }), page)).toBe(true);
    }
    expect(isPageFor(view({ step: 'bank_connection' }), 'accounts')).toBe(false);
  });

  it('should allow the transfer page once the step is already account selection', () => {
    expect(isPageFor(view({ step: 'account_selection' }), 'bank/transfer')).toBe(true);
    expect(isPageFor(view({ step: 'account_selection' }), 'bank/consent')).toBe(false);
  });

  it('should build the session path for nested pages', () => {
    expect(sessionPath('tok 1', 'bank/login')).toBe('/s/tok%201/bank/login');
  });
});
