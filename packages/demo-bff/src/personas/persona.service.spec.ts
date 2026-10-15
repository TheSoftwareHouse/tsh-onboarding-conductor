import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { accountIdAt, PersonaNotFoundError, PersonaService } from './persona.service';

describe('PersonaService', () => {
  const service = new PersonaService({
    get: () => join(__dirname, '..', '..', 'personas'),
  } as unknown as ConfigService<AppConfig, true>);

  it('lists the personae, the test-only one included, with their expected band and score', () => {
    expect(
      service
        .list()
        .map(({ id, expectedBand, expectedScore }) => ({ id, expectedBand, expectedScore })),
    ).toEqual([
      { id: 'sherlock_holmes', expectedBand: 'approved', expectedScore: 965 },
      { id: 'james_watson', expectedBand: 'review', expectedScore: 598 },
      { id: 'james_moriarty', expectedBand: 'declined', expectedScore: 362 },
      { id: 'fail_case', expectedBand: 'declined', expectedScore: 0 },
    ]);
  });

  it('gives every persona a profile, unique among the visible ones', () => {
    const list = service.list();

    expect(list.map(({ id, profile }) => ({ id, profile }))).toEqual([
      { id: 'sherlock_holmes', profile: 'high' },
      { id: 'james_watson', profile: 'medium' },
      { id: 'james_moriarty', profile: 'low' },
      { id: 'fail_case', profile: 'test' },
    ]);
    expect(list.every(({ profileLabel }) => profileLabel.length > 0)).toBe(true);

    const visible = list.filter(({ hidden }) => !hidden).map(({ profile }) => profile);
    expect(new Set(visible).size).toBe(visible.length);
  });

  it('gives every demo persona one checking and one savings account', () => {
    for (const { id } of service.list().filter(({ hidden }) => !hidden)) {
      expect(
        service
          .load(id)
          .accounts.map((account) => account.type)
          .sort(),
      ).toEqual(['CHECKING', 'SAVINGS']);
    }
  });

  it('has a stored document for every listed persona', () => {
    for (const { id } of service.list()) {
      expect(service.load(id).accounts.length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown id, including a path traversal attempt', () => {
    expect(() => service.load('nobody')).toThrow(PersonaNotFoundError);
    expect(() => service.load('../README')).toThrow(PersonaNotFoundError);
  });

  it('summarises accounts with opaque ids, display names and a masked account number', () => {
    const [checking, savings] = service.accounts('sherlock_holmes');

    expect(checking).toMatchObject({
      id: 'account-01',
      type: 'CHECKING',
      name: 'Current account',
      bankName: 'Algoan Demo',
      owner: 'SHERLOCK HOLMES',
      balance: 3633.03,
      currency: 'GBP',
    });
    expect(checking.accountNumber).toBe('6452');
    expect(JSON.stringify(checking)).not.toContain('GB85');
    expect(savings).toMatchObject({ id: 'account-02', type: 'SAVINGS', name: 'Savings account' });
  });

  it('gives fail_case its single checking account', () => {
    expect(service.accounts('fail_case').map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'account-01', type: 'CHECKING' },
    ]);
  });

  it('summarises one persona and rejects an unknown id', () => {
    expect(service.summary('james_watson')).toMatchObject({ profile: 'medium' });
    expect(() => service.summary('nobody')).toThrow(PersonaNotFoundError);
  });

  it('formats an account id from its position', () => {
    expect(accountIdAt(0)).toBe('account-01');
    expect(accountIdAt(9)).toBe('account-10');
  });
});
