import { compareDeclaredIdentity, type KycDeclaredIdentity } from './kyc-identity-comparison';

describe('compareDeclaredIdentity', () => {
  const declared: KycDeclaredIdentity = { lastName: 'Kowalska', dateOfBirth: '1990-05-14' };

  it('reports match when last name and date of birth both agree', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Kowalska',
      dateOfBirth: '1990-05-14',
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('detects a last-name mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Nowak',
      dateOfBirth: '1990-05-14',
    });

    expect(result).toEqual({ result: 'mismatch', divergedFields: ['lastName'] });
  });

  it('detects a date-of-birth mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Kowalska',
      dateOfBirth: '1991-01-01',
    });

    expect(result).toEqual({ result: 'mismatch', divergedFields: ['dateOfBirth'] });
  });

  it('names both fields when last name and date of birth both mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Nowak',
      dateOfBirth: '1991-01-01',
    });

    expect(result).toEqual({ result: 'mismatch', divergedFields: ['lastName', 'dateOfBirth'] });
  });

  it('matches Kowalska-Nowak against Kowalska Nowak — hyphen and space are the same separator', () => {
    const hyphenated: KycDeclaredIdentity = { ...declared, lastName: 'Kowalska-Nowak' };

    const result = compareDeclaredIdentity(hyphenated, {
      lastName: 'Kowalska Nowak',
      dateOfBirth: '1990-05-14',
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('matches case-insensitively and ignoring diacritics', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'KOWALSKA',
      dateOfBirth: '1990-05-14',
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('reports match when a single field is absent from the verified data, not mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Kowalska',
      // dateOfBirth absent — unknown, not a mismatch
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('reports no-verified-data when the provider returned an empty identity block', () => {
    const result = compareDeclaredIdentity(declared, {});

    expect(result).toEqual({ result: 'no-verified-data', divergedFields: [] });
  });

  it('reports no-verified-data when the provider returned no identity block at all', () => {
    const result = compareDeclaredIdentity(declared, undefined);

    expect(result).toEqual({ result: 'no-verified-data', divergedFields: [] });
  });

  it('reports no-verified-data, distinct from match, when both compared fields are absent', () => {
    const result = compareDeclaredIdentity(declared, { email: 'anna@example.com' } as never);

    expect(result).toEqual({ result: 'no-verified-data', divergedFields: [] });
  });
});
