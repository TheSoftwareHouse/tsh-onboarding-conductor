import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BankLoginDto } from './bank-login.dto';
import { CreateSessionDto } from './create-session.dto';

const errorsOf = async (dto: object, type: new () => object) =>
  (await validate(plainToInstance(type, dto))).map(({ property }) => property);

describe('BankLoginDto', () => {
  it.each(['qr', 'device'])('accepts the %s method', async (method) => {
    await expect(errorsOf({ persona: 'james_watson', method }, BankLoginDto)).resolves.toEqual([]);
  });

  it('rejects an unknown method and a persona outside the safe alphabet', async () => {
    await expect(errorsOf({ persona: '../etc', method: 'sms' }, BankLoginDto)).resolves.toEqual([
      'persona',
      'method',
    ]);
  });

  it('requires both fields', async () => {
    await expect(errorsOf({}, BankLoginDto)).resolves.toEqual(['persona', 'method']);
  });
});

describe('CreateSessionDto', () => {
  it('accepts a session without a persona', async () => {
    await expect(errorsOf({}, CreateSessionDto)).resolves.toEqual([]);
  });

  it('still rejects a persona outside the safe alphabet', async () => {
    await expect(errorsOf({ persona: '../etc' }, CreateSessionDto)).resolves.toEqual(['persona']);
  });
});
