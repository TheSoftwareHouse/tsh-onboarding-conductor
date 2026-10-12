import { KycCountryInvalidError } from '../kyc/kyc-country';
import type { KycApplicant } from '../kyc/kyc-provider.port';
import { buildFixedInfo } from './sumsub-applicant';

const APPLICANT: KycApplicant = {
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
    const fixedInfo = buildFixedInfo(APPLICANT);

    expect(fixedInfo.addresses).toEqual([
      { street: 'Marszałkowska 1', town: 'Warszawa', postCode: '00-001' },
    ]);
    expect(fixedInfo).not.toHaveProperty('street');
    expect(fixedInfo).not.toHaveProperty('town');
    expect(fixedInfo).not.toHaveProperty('postCode');
  });

  it('omits addresses entirely when no address field is present', () => {
    const fixedInfo = buildFixedInfo({
      ...APPLICANT,
      street: undefined,
      town: undefined,
      postCode: undefined,
    });

    expect(fixedInfo.addresses).toBeUndefined();
  });

  it('renames dateOfBirth to dob', () => {
    expect(buildFixedInfo(APPLICANT).dob).toBe('1990-05-14');
  });

  it('converts alpha-2 nationality and country to alpha-3', () => {
    const fixedInfo = buildFixedInfo(APPLICANT);

    expect(fixedInfo.nationality).toBe('POL');
    expect(fixedInfo.country).toBe('POL');
  });

  it('converts a different alpha-2 pair correctly', () => {
    const fixedInfo = buildFixedInfo({ ...APPLICANT, nationality: 'DE', country: 'FR' });

    expect(fixedInfo.nationality).toBe('DEU');
    expect(fixedInfo.country).toBe('FRA');
  });

  it('refuses an unmappable nationality code rather than passing it through', () => {
    expect(() => buildFixedInfo({ ...APPLICANT, nationality: 'ZZ' })).toThrow(
      KycCountryInvalidError,
    );
  });

  it('refuses an unmappable country code rather than passing it through', () => {
    expect(() => buildFixedInfo({ ...APPLICANT, country: 'XX' })).toThrow(KycCountryInvalidError);
  });
});
