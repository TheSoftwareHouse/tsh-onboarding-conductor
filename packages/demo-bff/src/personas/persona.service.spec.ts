import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { PersonaNotFoundError, PersonaService } from './persona.service';

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

  it('has a stored document for every listed persona', () => {
    for (const { id } of service.list()) {
      expect(service.load(id).accounts.length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown id, including a path traversal attempt', () => {
    expect(() => service.load('nobody')).toThrow(PersonaNotFoundError);
    expect(() => service.load('../README')).toThrow(PersonaNotFoundError);
  });

  it('summarises accounts with masked identifiers', () => {
    const [account] = service.accounts('sherlock_holmes');

    expect(account).toMatchObject({
      bankName: 'Algoan Demo',
      owner: 'SHERLOCK HOLMES',
      balance: 3633.03,
      currency: 'GBP',
    });
    expect(account.iban).toMatch(/^\*+6452$/);
    expect(account.iban).not.toContain('GB85');
  });
});
