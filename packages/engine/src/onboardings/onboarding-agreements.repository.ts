import { EntityManager, In } from 'typeorm';
import { type AgreementLinkStatus, type AgreementType } from '../agreements/agreement.types';
import { AgreementEntity } from '../agreements/entity/agreement.entity';
import { OnboardingAgreementEntity } from './entity/onboarding-agreement.entity';
import { OnboardingEntity } from './entity/onboarding.entity';

/**
 * How many onboardings one link statement carries. The publish fan-out can touch every onboarding
 * that ever accepted a family, so the array is chunked rather than sent whole — but a chunk is
 * still one statement, never one statement per onboarding. Both halves of the fan-out use it: the
 * link insert and the read that fetches the onboardings those links are for, so neither can send
 * an id list Postgres refuses to bind.
 */
const LINK_CHUNK_SIZE = 500;

const PENDING_LINK: AgreementLinkStatus = 'pending';
const ACCEPTED_LINK: AgreementLinkStatus = 'accepted';

/**
 * What happened to one `(onboarding, agreement)` pair a link write was asked for. `created` is
 * false when the pair was already linked, which is how a retried link call knows not to notify a
 * second time.
 */
export interface AgreementLinkResult {
  onboardingId: string;
  created: boolean;
}

/**
 * What a publish's fan-out needs of an onboarding to notify it. Deliberately narrower than the
 * row: `context` is a jsonb column that can hold the whole submitted onboarding, and a bulk
 * publish would otherwise drag every one of them into memory to send four fields.
 */
export type AgreementFanOutOnboarding = Pick<
  OnboardingEntity,
  'id' | 'workflowId' | 'workflowVersion' | 'status'
>;

/** One onboarding that is behind on a family, with the version it did accept. */
export interface OnboardingAcceptedVersion {
  onboardingId: string;
  acceptedVersion: number;
}

/** One family an onboarding holds, as accepted-versus-latest. */
export interface OnboardingAgreementSummary {
  key: string;
  type: AgreementType;
  latestAgreementId: string;
  latestVersion: number;
  acceptedVersion: number | null;
  acceptedAt: Date | null;
}

interface OnboardingAgreementRow {
  onboardingId: string;
  agreementId: string;
  status: AgreementLinkStatus;
  acceptedAt: Date | null;
  createdAt: Date;
}

/**
 * Reads and writes the `(onboarding, agreement)` link rows. Every statement here leans on the
 * composite primary key `(onboarding_id, agreement_id)`: it is what makes an idempotent link a
 * single `ON CONFLICT` insert instead of a read-then-write race, and what lets an onboarding
 * hold v1 `accepted` beside v2 `pending`.
 *
 * `status` and `accepted_at` are written together on purpose — the table's
 * `ck_onboarding_agreements_accepted_at` constraint rejects either half on its own.
 */
export class OnboardingAgreementsRepository {
  /**
   * Links an agreement to each onboarding as `pending`, skipping pairs already linked, and
   * reports which of the two happened for every onboarding asked for. A single statement per
   * chunk does both: the data-modifying CTE inserts what it can, and the outer join against its
   * `RETURNING` rows marks the rest as pre-existing.
   */
  async createPendingLinks(
    manager: EntityManager,
    agreement: AgreementEntity,
    onboardingIds: readonly string[],
  ): Promise<AgreementLinkResult[]> {
    const results: AgreementLinkResult[] = [];

    for (let offset = 0; offset < onboardingIds.length; offset += LINK_CHUNK_SIZE) {
      const chunk = onboardingIds.slice(offset, offset + LINK_CHUNK_SIZE);
      const rows = await manager.query<AgreementLinkResult[]>(
        `WITH requested AS (
           SELECT DISTINCT unnest($1::uuid[]) AS onboarding_id
         ), inserted AS (
           INSERT INTO onboarding_agreements (onboarding_id, agreement_id, status)
           SELECT requested.onboarding_id, $2, $3 FROM requested
           ON CONFLICT ON CONSTRAINT pk_onboarding_agreements DO NOTHING
           RETURNING onboarding_id
         )
         SELECT requested.onboarding_id AS "onboardingId",
                (inserted.onboarding_id IS NOT NULL) AS created
           FROM requested
           LEFT JOIN inserted ON inserted.onboarding_id = requested.onboarding_id
          ORDER BY requested.onboarding_id`,
        [chunk, agreement.id, PENDING_LINK],
      );

      results.push(...rows);
    }

    return results;
  }

  /**
   * Marks the pair accepted, creating the link when the onboarding was never linked to this
   * version. A step declaration names only a family key, so a submit resolves the latest published
   * version, which has no link row when a version was published mid-flow — that is the path the
   * upsert exists for, not the accept route, which refuses a pair it cannot already find. An
   * already-accepted link keeps its original `accepted_at`, so a replayed accept does not move
   * the timestamp.
   */
  async acceptLink(
    manager: EntityManager,
    agreement: AgreementEntity,
    onboardingId: string,
    acceptedAt: Date,
  ): Promise<OnboardingAgreementEntity> {
    const rows = await manager.query<OnboardingAgreementRow[]>(
      `INSERT INTO onboarding_agreements (onboarding_id, agreement_id, status, accepted_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT pk_onboarding_agreements DO UPDATE
         SET status = EXCLUDED.status,
             accepted_at = COALESCE(onboarding_agreements.accepted_at, EXCLUDED.accepted_at)
       RETURNING onboarding_id AS "onboardingId",
                 agreement_id AS "agreementId",
                 status,
                 accepted_at AS "acceptedAt",
                 created_at AS "createdAt"`,
      [onboardingId, agreement.id, ACCEPTED_LINK, acceptedAt],
    );

    return Object.assign(new OnboardingAgreementEntity(), rows[0]);
  }

  /**
   * The link one onboarding holds against one published version, or `undefined` when the pair was
   * never linked. What makes the unguarded accept route a read of an existing obligation rather
   * than a second way to create one.
   */
  async findLink(
    manager: EntityManager,
    agreement: AgreementEntity,
    onboardingId: string,
  ): Promise<OnboardingAgreementEntity | undefined> {
    const rows = await manager.query<OnboardingAgreementRow[]>(
      `SELECT onboarding_id AS "onboardingId",
              agreement_id AS "agreementId",
              status,
              accepted_at AS "acceptedAt",
              created_at AS "createdAt"
         FROM onboarding_agreements
        WHERE onboarding_id = $1
          AND agreement_id = $2`,
      [onboardingId, agreement.id],
    );

    if (rows.length === 0) {
      return undefined;
    }

    return Object.assign(new OnboardingAgreementEntity(), rows[0]);
  }

  /**
   * Every onboarding whose highest accepted version of this agreement's family is lower than
   * this agreement's own version, with that accepted version — the publish fan-out's target list
   * and the `previousAcceptedVersion` its notification carries, in one statement for the whole
   * set. An onboarding that never accepted the family is not behind on it and is not returned.
   */
  async findOnboardingsBelowVersion(
    manager: EntityManager,
    agreement: AgreementEntity,
  ): Promise<OnboardingAcceptedVersion[]> {
    return manager.query<OnboardingAcceptedVersion[]>(
      `SELECT link.onboarding_id AS "onboardingId",
              MAX(published.version) AS "acceptedVersion"
         FROM onboarding_agreements link
         JOIN agreements published ON published.id = link.agreement_id
        WHERE published.key = $1
          AND link.status = $2
        GROUP BY link.onboarding_id
       HAVING MAX(published.version) < $3
        ORDER BY link.onboarding_id`,
      [agreement.key, ACCEPTED_LINK, agreement.version],
    );
  }

  /**
   * The onboardings a publish is about to notify, by id. Which onboardings those are is already
   * known - `findOnboardingsBelowVersion` answers that - but the notification also carries each
   * onboarding's own workflow and status, and its own workflow is the one whose notify webhook
   * receives the event, never the publisher's.
   *
   * Chunked on the same size as the link insert: one bind parameter per id against a statement
   * Postgres caps at 65535 of them would otherwise fail the whole publish once a family reached
   * that many onboardings.
   */
  async findOnboardings(
    manager: EntityManager,
    onboardingIds: readonly string[],
  ): Promise<AgreementFanOutOnboarding[]> {
    const repository = manager.getRepository(OnboardingEntity);
    const onboardings: AgreementFanOutOnboarding[] = [];

    for (let offset = 0; offset < onboardingIds.length; offset += LINK_CHUNK_SIZE) {
      const chunk = onboardingIds.slice(offset, offset + LINK_CHUNK_SIZE);

      onboardings.push(
        ...(await repository.find({
          select: { id: true, workflowId: true, workflowVersion: true, status: true },
          where: { id: In([...chunk]) },
        })),
      );
    }

    return onboardings;
  }

  /**
   * One row per family this onboarding is linked to, pairing the highest version it accepted
   * with the highest version published. A family it holds but never accepted reports a null
   * accepted version.
   */
  async findSummaries(
    manager: EntityManager,
    onboardingId: string,
  ): Promise<OnboardingAgreementSummary[]> {
    return manager.query<OnboardingAgreementSummary[]>(
      `WITH held AS (
         SELECT DISTINCT published.key
           FROM onboarding_agreements link
           JOIN agreements published ON published.id = link.agreement_id
          WHERE link.onboarding_id = $1
       ), latest AS (
         SELECT DISTINCT ON (published.key)
                published.key, published.id, published.type, published.version
           FROM agreements published
           JOIN held ON held.key = published.key
          ORDER BY published.key, published.version DESC
       ), accepted AS (
         SELECT DISTINCT ON (published.key)
                published.key, published.version, link.accepted_at
           FROM onboarding_agreements link
           JOIN agreements published ON published.id = link.agreement_id
          WHERE link.onboarding_id = $1
            AND link.status = $2
          ORDER BY published.key, published.version DESC
       )
       SELECT latest.key AS "key",
              latest.type AS "type",
              latest.id AS "latestAgreementId",
              latest.version AS "latestVersion",
              accepted.version AS "acceptedVersion",
              accepted.accepted_at AS "acceptedAt"
         FROM latest
         LEFT JOIN accepted ON accepted.key = latest.key
        ORDER BY latest.key`,
      [onboardingId, ACCEPTED_LINK],
    );
  }
}
