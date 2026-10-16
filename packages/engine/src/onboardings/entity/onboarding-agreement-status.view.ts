import { ViewColumn, ViewEntity } from 'typeorm';
import { type OnboardingAgreementStatus } from '../../agreements/agreement.types';

/**
 * The derived agreement status of an onboarding, computed by the database rather than stored.
 *
 * Publishing a new version would otherwise have to bulk-update every affected onboarding, which
 * races with a concurrent acceptance of the previous version and goes stale the moment a write
 * path forgets to maintain it. A view cannot be wrong. It is also what lets the existing
 * paginated onboarding list filter on the status: `paginateQueryBuilder` calls `getMany()`, so a
 * raw `addSelect` expression would be dropped, while a joined view entity hydrates and gives
 * `andWhere` a real column to filter on.
 *
 * An onboarding with no links at all produces no row here; readers coalesce that to
 * `not_accepted`.
 *
 * The expression below mirrors the view created by migration `0001_initial_schema`, which is
 * the only thing that ever creates or drops it. `synchronize: false` keeps both schema sync and
 * TypeORM's own migration generation away from it.
 *
 * Grouped by `agreement_id`, the family's identity row, rather than `key`: a version is a row of
 * its own now, so recovering the family no longer means matching on the shared string.
 */
@ViewEntity({
  name: 'onboarding_agreement_statuses',
  synchronize: false,
  expression: `
    WITH latest AS (
      SELECT agreement_id, MAX(version) AS version FROM agreement_versions GROUP BY agreement_id
    ), per_agreement AS (
      SELECT oa.onboarding_id, av.agreement_id,
             MAX(CASE WHEN oa.status = 'accepted' THEN av.version END) AS accepted_version
        FROM onboarding_agreements oa
        JOIN agreement_versions av ON av.agreement_version_id = oa.agreement_version_id
       GROUP BY oa.onboarding_id, av.agreement_id
    )
    SELECT pa.onboarding_id,
           CASE WHEN bool_or(pa.accepted_version IS NULL)     THEN 'not_accepted'
                WHEN bool_or(pa.accepted_version < l.version) THEN 'outdated'
                ELSE 'current' END AS agreement_status
      FROM per_agreement pa JOIN latest l ON l.agreement_id = pa.agreement_id
     GROUP BY pa.onboarding_id
  `,
})
export class OnboardingAgreementStatusView {
  @ViewColumn({ name: 'onboarding_id' })
  onboardingId!: string;

  @ViewColumn({ name: 'agreement_status' })
  agreementStatus!: OnboardingAgreementStatus;
}
