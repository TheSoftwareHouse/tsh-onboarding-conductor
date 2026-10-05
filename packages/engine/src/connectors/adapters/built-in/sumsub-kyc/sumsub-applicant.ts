import type { KycApplicant } from '../kyc/kyc-provider.port';
import { toAlpha3 } from '../kyc/kyc-country';

/**
 * One postal address. `street`, `town` and `postCode` only ever appear here — never flat on
 * `fixedInfo` — because Sumsub's `individual-standard-v2` level declares them flat but silently
 * does not populate them unless they arrive nested under `addresses[]`. Confirmed against the
 * brief and load-bearing: sent flat, the data is accepted and dropped with no error.
 */
export type SumsubApplicantAddress = Readonly<{
  street?: string;
  town?: string;
  postCode?: string;
}>;

/**
 * The `fixedInfo` body sent to `createApplicant`. `nationality` and `country` are ISO alpha-3,
 * converted from the applicant's alpha-2 at this boundary — Sumsub's API rejects alpha-2 silently
 * rather than erroring, so an unmappable code is refused here instead of reaching the provider.
 */
export type SumsubFixedInfo = Readonly<{
  firstName: string;
  lastName: string;
  dob: string;
  nationality: string;
  country: string;
  addresses?: readonly [SumsubApplicantAddress];
}>;

function buildAddress(applicant: KycApplicant): readonly [SumsubApplicantAddress] | undefined {
  const { street, town, postCode } = applicant;

  if (street === undefined && town === undefined && postCode === undefined) {
    return undefined;
  }

  return [{ street, town, postCode }];
}

/**
 * Builds the `fixedInfo` body from the kernel's applicant. The two provider traps this encodes:
 * `street`/`town`/`postCode` are nested under `addresses[]`, never flat; `nationality` and
 * `country` are converted from alpha-2 to Sumsub's required alpha-3, and an unmappable code throws
 * rather than reaching the provider.
 */
export function buildFixedInfo(applicant: KycApplicant): SumsubFixedInfo {
  const addresses = buildAddress(applicant);

  return {
    firstName: applicant.firstName,
    lastName: applicant.lastName,
    dob: applicant.dateOfBirth,
    nationality: toAlpha3(applicant.nationality, 'nationality'),
    country: toAlpha3(applicant.country, 'country'),
    ...(addresses ? { addresses } : {}),
  };
}
