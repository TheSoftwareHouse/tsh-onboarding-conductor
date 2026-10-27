import { describe, expect, it } from 'vitest';
import { findAgreementKeyProblem, suggestAgreementKey, type Agreement } from './agreements';

const AGREEMENTS: Agreement[] = [
  { key: 'terms', step: 'agree', acceptedWhen: 'termsAccepted' },
  { key: 'privacy', step: 'agree', acceptedWhen: 'privacyAccepted' },
];

describe('findAgreementKeyProblem', () => {
  it('accepts a lowercase key with digits and dashes', () => {
    expect(findAgreementKeyProblem(AGREEMENTS, 0, 'eu-b2c-terms')).toBeNull();
  });

  it('refuses an empty key, a key the engine refuses, and a key another agreement has', () => {
    expect(findAgreementKeyProblem(AGREEMENTS, 0, '')).toBe('An agreement needs a key');
    expect(findAgreementKeyProblem(AGREEMENTS, 0, 'Terms')).toBe(
      'Use lowercase letters, digits and -',
    );
    expect(findAgreementKeyProblem(AGREEMENTS, 0, '-terms')).toBe(
      'Use lowercase letters, digits and -',
    );
    expect(findAgreementKeyProblem(AGREEMENTS, 0, 'privacy')).toBe(
      'Another agreement uses this key',
    );
  });

  it('lets an agreement keep its own key', () => {
    expect(findAgreementKeyProblem(AGREEMENTS, 1, 'privacy')).toBeNull();
  });
});

describe('suggestAgreementKey', () => {
  it('turns a field name into a key', () => {
    expect(suggestAgreementKey([], 'termsAccepted')).toBe('terms-accepted');
    expect(suggestAgreementKey([], 'accepted_terms')).toBe('accepted-terms');
  });

  it('suffixes a key already taken', () => {
    expect(suggestAgreementKey(AGREEMENTS, 'terms')).toBe('terms-2');
  });
});
