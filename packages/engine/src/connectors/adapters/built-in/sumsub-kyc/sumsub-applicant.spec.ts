import {
  buildFixedInfo,
  compareDeclaredIdentity,
  SumsubApplicantPayloadInvalidError,
  SumsubUnmappableCountryCodeError,
  type SumsubFixedInfo,
} from './sumsub-applicant';

const VALID_PAYLOAD: Readonly<Record<string, unknown>> = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  dateOfBirth: '1990-05-14',
  nationality: 'PL',
  country: 'PL',
  street: 'Marszałkowska 1',
  town: 'Warszawa',
  postCode: '00-001',
};

describe('buildFixedInfo', () => {
  it('nests street, town and postCode under addresses[] and never flat', () => {
    const fixedInfo = buildFixedInfo(VALID_PAYLOAD);

    expect(fixedInfo.addresses).toEqual([
      { street: 'Marszałkowska 1', town: 'Warszawa', postCode: '00-001' },
    ]);
    expect(fixedInfo).not.toHaveProperty('street');
    expect(fixedInfo).not.toHaveProperty('town');
    expect(fixedInfo).not.toHaveProperty('postCode');
  });

  it('omits addresses entirely when no address field is present', () => {
    const payload = { ...VALID_PAYLOAD };
    delete (payload as Record<string, unknown>).street;
    delete (payload as Record<string, unknown>).town;
    delete (payload as Record<string, unknown>).postCode;

    const fixedInfo = buildFixedInfo(payload);

    expect(fixedInfo.addresses).toBeUndefined();
  });

  it('converts alpha-2 nationality and country to alpha-3', () => {
    const fixedInfo = buildFixedInfo(VALID_PAYLOAD);

    expect(fixedInfo.nationality).toBe('POL');
    expect(fixedInfo.country).toBe('POL');
  });

  it('converts a different alpha-2 pair correctly', () => {
    const fixedInfo = buildFixedInfo({ ...VALID_PAYLOAD, nationality: 'DE', country: 'FR' });

    expect(fixedInfo.nationality).toBe('DEU');
    expect(fixedInfo.country).toBe('FRA');
  });

  it('refuses an unmappable nationality code rather than passing it through', () => {
    expect(() => buildFixedInfo({ ...VALID_PAYLOAD, nationality: 'ZZ' })).toThrow(
      SumsubUnmappableCountryCodeError,
    );
  });

  it('refuses an unmappable country code rather than passing it through', () => {
    expect(() => buildFixedInfo({ ...VALID_PAYLOAD, country: 'XX' })).toThrow(
      SumsubUnmappableCountryCodeError,
    );
  });

  it('refuses a payload missing a required identity field', () => {
    const payload = { ...VALID_PAYLOAD };
    delete (payload as Record<string, unknown>).lastName;

    expect(() => buildFixedInfo(payload)).toThrow(SumsubApplicantPayloadInvalidError);
  });
});

describe('compareDeclaredIdentity', () => {
  const declared: SumsubFixedInfo = {
    firstName: 'Anna',
    lastName: 'Kowalska',
    dob: '1990-05-14',
    nationality: 'POL',
    country: 'POL',
  };

  it('reports match when last name and date of birth both agree', () => {
    const result = compareDeclaredIdentity(declared, {
      firstName: 'Anna',
      lastName: 'Kowalska',
      dob: '1990-05-14',
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('detects a last-name mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Nowak',
      dob: '1990-05-14',
    });

    expect(result).toEqual({ result: 'mismatch', divergedFields: ['lastName'] });
  });

  it('detects a date-of-birth mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Kowalska',
      dob: '1991-01-01',
    });

    expect(result).toEqual({ result: 'mismatch', divergedFields: ['dob'] });
  });

  it('names both fields when last name and date of birth both mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Nowak',
      dob: '1991-01-01',
    });

    expect(result).toEqual({ result: 'mismatch', divergedFields: ['lastName', 'dob'] });
  });

  it('matches Kowalska-Nowak against Kowalska Nowak — hyphen and space are the same separator', () => {
    const hyphenated: SumsubFixedInfo = { ...declared, lastName: 'Kowalska-Nowak' };

    const result = compareDeclaredIdentity(hyphenated, {
      lastName: 'Kowalska Nowak',
      dob: '1990-05-14',
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('matches case-insensitively and ignoring diacritics', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'KOWALSKA',
      dob: '1990-05-14',
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('reports match when a single field is absent from the verified data, not mismatch', () => {
    const result = compareDeclaredIdentity(declared, {
      lastName: 'Kowalska',
      // dob absent — unknown, not a mismatch
    });

    expect(result).toEqual({ result: 'match', divergedFields: [] });
  });

  it('reports no-verified-data when Sumsub returned an empty identity block', () => {
    const result = compareDeclaredIdentity(declared, {});

    expect(result).toEqual({ result: 'no-verified-data', divergedFields: [] });
  });

  it('reports no-verified-data when Sumsub returned no identity block at all', () => {
    const result = compareDeclaredIdentity(declared, undefined);

    expect(result).toEqual({ result: 'no-verified-data', divergedFields: [] });
  });

  it('reports no-verified-data, distinct from match, when both compared fields are absent', () => {
    const result = compareDeclaredIdentity(declared, { email: 'anna@example.com' });

    expect(result).toEqual({ result: 'no-verified-data', divergedFields: [] });
  });
});
