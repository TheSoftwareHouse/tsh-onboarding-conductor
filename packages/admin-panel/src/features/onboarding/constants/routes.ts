/** Path the onboardings list is mounted at, and the section a details page returns to. */
export const ADMIN_ONBOARDINGS_PATH = '/onboardings';

/** Route pattern the onboarding details page is mounted at. */
export const ONBOARDING_DETAILS_ROUTE = `${ADMIN_ONBOARDINGS_PATH}/:onboardingId`;

/** Path of one onboarding's details page, which is what a list row links to. */
export function buildOnboardingDetailsPath(onboardingId: string): string {
  return `${ADMIN_ONBOARDINGS_PATH}/${encodeURIComponent(onboardingId)}`;
}
