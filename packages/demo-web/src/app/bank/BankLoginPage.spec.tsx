import { describe, expect, it } from 'vitest';

import type { PersonaSummary } from '@/api/bnpl/bnpl.client';

import { isPasswordAccepted, profileCards } from './BankLoginPage';

function persona(id: string, profile: PersonaSummary['profile'], hidden?: true): PersonaSummary {
  return {
    id,
    name: id,
    story: '',
    expectedBand: 'approved',
    expectedScore: 0,
    profile,
    profileLabel: profile,
    hidden,
  };
}

const PERSONAE = [
  persona('moriarty', 'low'),
  persona('fail_case', 'test', true),
  persona('sherlock', 'high'),
  persona('watson', 'medium'),
];

describe('profile cards', () => {
  it('should map the three profiles to the visible personae, best score first', () => {
    expect(profileCards(PERSONAE, null).map((card) => card.id)).toEqual([
      'sherlock',
      'watson',
      'moriarty',
    ]);
  });

  it('should add the test profile only when the session carries the hidden persona', () => {
    expect(profileCards(PERSONAE, 'fail_case').map((card) => card.id)).toContain('fail_case');
    expect(profileCards(PERSONAE, 'sherlock').map((card) => card.id)).not.toContain('fail_case');
  });
});

describe('bank password', () => {
  it('should accept any non-blank value and refuse an empty or blank one', () => {
    expect(isPasswordAccepted('hunter2')).toBe(true);
    expect(isPasswordAccepted(' x ')).toBe(true);
    expect(isPasswordAccepted('')).toBe(false);
    expect(isPasswordAccepted('   ')).toBe(false);
  });
});
