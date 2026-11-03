import type { Faker } from '@faker-js/faker';
import {
  ACCOUNT_PURPOSES,
  COUNTRIES,
  EMPLOYMENT_STATUSES,
  HIGH_RISK_COUNTRIES,
  LOW_RISK_COUNTRIES,
  MAX_APPLICANT_AGE_YEARS,
  MIN_APPLICANT_AGE_YEARS,
  MONTHLY_BANDS,
  OCCUPATION_GROUPS,
  RISKY_SOURCES_OF_FUNDS,
  SAFE_SOURCES_OF_FUNDS,
} from '../workflow/analyst-investigation';

/** Which of the `risk` score rules an applicant is generated to trigger. */
export interface RiskArchetype {
  highRiskCountry: boolean;
  pepSelfDeclared: boolean;
  riskySourceOfFunds: boolean;
}

/** The body of the `collect_profile` submit. */
export interface Applicant {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  street: string;
  town: string;
  postCode: string;
  country: string;
  accountPurpose: string;
  employmentStatus: string;
  occupationGroup: string;
  occupationTitle: string;
  sourceOfFunds: string;
  monthlyIncomingBand: string;
  monthlyOutgoingBand: string;
  pepSelfDeclared: boolean;
  email: string;
  phoneNumber: string;
}

/** A fixed reference, so a birth date depends on the seed alone and not on the day of the run. */
const BIRTHDATE_REFERENCE_DATE = '2026-01-01';
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

/**
 * UK Ofcom's drama range, +44 7700 900000 to 900999: reserved for fiction, never assigned to a
 * subscriber. The last three digits come from the applicant's ordinal.
 */
const RESERVED_PHONE_PREFIX = '+447700900';
const RESERVED_PHONE_SUFFIX_DIGITS = 3;
const RESERVED_PHONE_SUFFIX_COUNT = 10 ** RESERVED_PHONE_SUFFIX_DIGITS;

const EMAIL_DOMAIN = 'example.com';

/**
 * One applicant per `ordinal`, which makes the email and the phone number unique across a run.
 * Names, birth date, address and every answer outside the risk rules come from `faker`.
 */
export function generateApplicant(
  faker: Faker,
  archetype: RiskArchetype,
  ordinal: number,
): Applicant {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const pepSelfDeclared = archetype.pepSelfDeclared;

  return {
    firstName,
    lastName,
    dateOfBirth: faker.date
      .birthdate({
        mode: 'age',
        min: MIN_APPLICANT_AGE_YEARS,
        max: MAX_APPLICANT_AGE_YEARS,
        refDate: BIRTHDATE_REFERENCE_DATE,
      })
      .toISOString()
      .slice(0, ISO_DATE_LENGTH),
    nationality: faker.helpers.arrayElement(COUNTRIES),
    street: faker.location.streetAddress(),
    town: faker.location.city(),
    postCode: faker.location.zipCode(),
    country: faker.helpers.arrayElement(
      archetype.highRiskCountry ? HIGH_RISK_COUNTRIES : LOW_RISK_COUNTRIES,
    ),
    accountPurpose: faker.helpers.arrayElement(ACCOUNT_PURPOSES),
    employmentStatus: faker.helpers.arrayElement(EMPLOYMENT_STATUSES),
    occupationGroup: faker.helpers.arrayElement(OCCUPATION_GROUPS),
    occupationTitle: faker.person.jobTitle(),
    sourceOfFunds: faker.helpers.arrayElement(
      archetype.riskySourceOfFunds ? RISKY_SOURCES_OF_FUNDS : SAFE_SOURCES_OF_FUNDS,
    ),
    monthlyIncomingBand: faker.helpers.arrayElement(MONTHLY_BANDS),
    monthlyOutgoingBand: faker.helpers.arrayElement(MONTHLY_BANDS),
    pepSelfDeclared,
    email: `${toSlug(firstName)}.${toSlug(lastName)}.${ordinal}@${EMAIL_DOMAIN}`,
    phoneNumber: `${RESERVED_PHONE_PREFIX}${String(ordinal % RESERVED_PHONE_SUFFIX_COUNT).padStart(RESERVED_PHONE_SUFFIX_DIGITS, '0')}`,
  };
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
