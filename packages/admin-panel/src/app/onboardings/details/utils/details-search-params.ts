import { createSerializer, parseAsStringLiteral } from 'nuqs';

export const ONBOARDING_DETAILS_TABS = ['history', 'scores'] as const;

export type OnboardingDetailsTab = (typeof ONBOARDING_DETAILS_TABS)[number];

/** The one criterion the details page commits to the URL: which tab is open. See ADR 0018. */
export const detailsSearchParams = {
  tab: parseAsStringLiteral(ONBOARDING_DETAILS_TABS).withDefault('history'),
};

const serialize = createSerializer(detailsSearchParams);

/** A tab link's target: `base` with `tab` set, so a tab switch keeps the rest of the search. */
export function serializeDetailsTab(tab: OnboardingDetailsTab, base: string): string {
  return serialize(base, { tab });
}
