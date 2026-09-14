/**
 * What an agreement family *is*, along the same classification axis a workflow uses for its
 * connectors. `type` is a property of the family rather than of one version: publishing a new
 * version under an existing `key` with a different `type` is rejected, so every version of
 * `eu-b2c-terms` classifies the same way.
 */
export const AGREEMENT_TYPES = ['terms_and_conditions', 'privacy_notice'] as const;

export type AgreementType = (typeof AGREEMENT_TYPES)[number];

/**
 * The state of one `(onboarding, agreement)` link. `pending` is owed and not yet accepted;
 * `accepted` carries the `accepted_at` timestamp the link table's check constraint ties to it.
 *
 * An onboarding legitimately holds both at once for one family — v1 `accepted` beside v2
 * `pending` is precisely what "outdated" means — which is why the link is keyed by
 * `(onboarding_id, agreement_id)` and not by family.
 */
export const AGREEMENT_LINK_STATUSES = ['pending', 'accepted'] as const;

export type AgreementLinkStatus = (typeof AGREEMENT_LINK_STATUSES)[number];

/**
 * The whole-onboarding status derived from those links across every family it holds, and never
 * stored: `not_accepted` when any family has no accepted version, `outdated` when every family
 * has one but at least one of them is behind the latest published version, `current` otherwise.
 *
 * The `onboarding_agreement_statuses` view is the single place this is computed. An onboarding
 * with no links at all does not appear in it, and readers coalesce that absence to
 * `not_accepted`.
 */
export const ONBOARDING_AGREEMENT_STATUSES = ['current', 'outdated', 'not_accepted'] as const;

export type OnboardingAgreementStatus = (typeof ONBOARDING_AGREEMENT_STATUSES)[number];

/**
 * What every reader coalesces to when the view holds no row for an onboarding, or when a family
 * it holds has nothing accepted. Named once here rather than repeated at each reader so the list
 * filter, the admin summary and the per-family projection cannot drift apart.
 */
export const NOT_ACCEPTED_AGREEMENT_STATUS: OnboardingAgreementStatus = 'not_accepted';
