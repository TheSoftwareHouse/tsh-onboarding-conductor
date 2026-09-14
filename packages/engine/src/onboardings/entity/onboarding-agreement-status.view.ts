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
 * The expression below mirrors the view created by migration `0022_create_agreements`, which is
 * the only thing that ever creates or drops it. `synchronize: false` keeps both schema sync and
 * TypeORM's own migration generation away from it.
 */
@ViewEntity({
  name: 'onboarding_agreement_statuses',
  synchronize: false,
  expression: `
    WITH latest AS (
      SELECT key, MAX(version) AS version FROM agreements GROUP BY key
    ), per_key AS (
      SELECT oa.onboarding_id, a.key,
             MAX(CASE WHEN oa.status = 'accepted' THEN a.version END) AS accepted_version
        FROM onboarding_agreements oa
        JOIN agreements a ON a.id = oa.agreement_id
       GROUP BY oa.onboarding_id, a.key
    )
    SELECT pk.onboarding_id,
           CASE WHEN bool_or(pk.accepted_version IS NULL)      THEN 'not_accepted'
                WHEN bool_or(pk.accepted_version < l.version)  THEN 'outdated'
                ELSE 'current' END AS agreement_status
      FROM per_key pk JOIN latest l ON l.key = pk.key
     GROUP BY pk.onboarding_id
  `,
})
export class OnboardingAgreementStatusView {
  @ViewColumn({ name: 'onboarding_id' })
  onboardingId!: string;

  @ViewColumn({ name: 'agreement_status' })
  agreementStatus!: OnboardingAgreementStatus;
}
