import { describe, expect, it } from 'vitest';

import type { PersonaSummary } from '@/api/bnpl/bnpl.client';

import { profileCards, toMethod } from './BankLoginPage';

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

  it('should read the login method from the query and default to the device', () => {
    expect(toMethod('qr')).toBe('qr');
    expect(toMethod('device')).toBe('device');
    expect(toMethod(null)).toBe('device');
    expect(toMethod('other')).toBe('device');
  });
});
