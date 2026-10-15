import { EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { NOT_ACCEPTED_AGREEMENT_STATUS } from '../agreements/agreement.types';
import { paginateQueryBuilder, resolvePaginationWindow, type PaginatedResult } from '../pagination';
import { OnboardingAgreementStatusView } from './entity/onboarding-agreement-status.view';
import { OnboardingEntity } from './entity/onboarding.entity';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';

export type AdminOnboardingFilters = Omit<ListAdminOnboardingsQueryDto, 'page' | 'limit'>;

export interface InitialOnboardingData {
  id: string;
  workflowVersionId: string;
  status: OnboardingEntity['status'];
  currentStep: string | null;
  context: Record<string, unknown>;
  expiresAt: Date | null;
  completedAt: Date | null;
  rejectionReason: OnboardingEntity['rejectionReason'];
  scores: Record<string, number>;
  pendingConnector: OnboardingEntity['pendingConnector'];
}

export class OnboardingsRepository {
  async findById(manager: EntityManager, id: string): Promise<OnboardingEntity | null> {
    return this.createReadQueryBuilder(manager).where('onboarding.id = :id', { id }).getOne();
  }

  async createInitial(
    manager: EntityManager,
    data: InitialOnboardingData,
  ): Promise<OnboardingEntity> {
    const repository = manager.getRepository(OnboardingEntity);
    const onboarding = repository.create(data);

    return repository.save(onboarding);
  }

  async lockAndRefreshPreflight(
    manager: EntityManager,
    onboarding: OnboardingEntity,
  ): Promise<void> {
    const persistedOnboarding = await manager.getRepository(OnboardingEntity).findOne({
      where: { id: onboarding.id },
      lock: { mode: 'for_no_key_update' },
    });

    if (!persistedOnboarding) {
      throw new Error('ONBOARDING_LOCK_REFRESH_FAILED');
    }

    Object.assign(onboarding, {
      id: persistedOnboarding.id,
      workflowVersionId: persistedOnboarding.workflowVersionId,
      status: persistedOnboarding.status,
      currentStep: persistedOnboarding.currentStep,
      context: persistedOnboarding.context,
      expiresAt: persistedOnboarding.expiresAt,
      createdAt: persistedOnboarding.createdAt,
      updatedAt: persistedOnboarding.updatedAt,
      completedAt: persistedOnboarding.completedAt,
      rejectionReason: persistedOnboarding.rejectionReason,
      scores: persistedOnboarding.scores,
      pendingConnector: persistedOnboarding.pendingConnector,
    });
  }

  async saveLocked(
    manager: EntityManager,
    onboarding: OnboardingEntity,
  ): Promise<OnboardingEntity> {
    return manager.getRepository(OnboardingEntity).save(onboarding);
  }

  async findForAdmin(
    manager: EntityManager,
    filters: ListAdminOnboardingsQueryDto,
  ): Promise<PaginatedResult<OnboardingEntity>> {
    const queryBuilder = this.createReadQueryBuilder(manager);

    this.applyAdminFilters(queryBuilder, filters);

    queryBuilder.orderBy('onboarding.createdAt', 'DESC').addOrderBy('onboarding.id', 'DESC');

    return paginateQueryBuilder(queryBuilder, resolvePaginationWindow(filters));
  }

  async findAdminExportBatch(
    manager: EntityManager,
    filters: AdminOnboardingFilters,
    afterId: string | null,
    batchSize: number,
  ): Promise<OnboardingEntity[]> {
    const queryBuilder = this.createExportQueryBuilder(manager, filters);

    // A row deleted mid-export would leave the subquery empty and end the export early; onboardings are never deleted today.
    if (afterId !== null) {
      queryBuilder.andWhere(
        '(onboarding.createdAt, onboarding.id) < (SELECT o.created_at, o.id FROM onboardings o WHERE o.id = :lastId)',
        { lastId: afterId },
      );
    }

    const onboardings = await queryBuilder
      .orderBy('onboarding.createdAt', 'DESC')
      .addOrderBy('onboarding.id', 'DESC')
      // Every join is to-one, so `limit` is exact; `take` would add a DISTINCT query and an id reload.
      .limit(batchSize)
      .getMany();

    if (filters.agreementStatus !== undefined || onboardings.length === 0) {
      return onboardings;
    }

    // Restricted by the view's grouping column, so Postgres reads only this batch's agreement rows.
    const statuses = await manager.getRepository(OnboardingAgreementStatusView).find({
      where: { onboardingId: In(onboardings.map((onboarding) => onboarding.id)) },
    });
    const statusesById = new Map(statuses.map((status) => [status.onboardingId, status]));

    for (const onboarding of onboardings) {
      onboarding.agreementStatusView = statusesById.get(onboarding.id);
    }

    return onboardings;
  }

  async findWorkflowVersionsForAdmin(
    manager: EntityManager,
    filters: AdminOnboardingFilters,
  ): Promise<Array<{ workflowKey: string; version: number }>> {
    const rows = await this.createExportQueryBuilder(manager, filters)
      .select('workflow.key', 'workflowKey')
      .addSelect('workflowVersion.version', 'version')
      .distinct(true)
      .orderBy('workflow.key', 'ASC')
      .addOrderBy('workflowVersion.version', 'ASC')
      .getRawMany<{ workflowKey: string; version: number | string }>();

    return rows.map((row) => ({ workflowKey: row.workflowKey, version: Number(row.version) }));
  }

  /** The export's filtered read; joined, the view aggregates every agreement row, so only its filter joins it. */
  private createExportQueryBuilder(
    manager: EntityManager,
    filters: AdminOnboardingFilters,
  ): SelectQueryBuilder<OnboardingEntity> {
    const queryBuilder =
      filters.agreementStatus !== undefined
        ? this.createReadQueryBuilder(manager)
        : this.createWorkflowQueryBuilder(manager);

    this.applyAdminFilters(queryBuilder, filters);

    return queryBuilder;
  }

  private applyAdminFilters(
    queryBuilder: SelectQueryBuilder<OnboardingEntity>,
    filters: AdminOnboardingFilters,
  ): void {
    if (filters.status !== undefined) {
      queryBuilder.andWhere('onboarding.status = :status', { status: filters.status });
    }

    if (filters.workflowId !== undefined) {
      queryBuilder.andWhere('workflow.key = :workflowId', {
        workflowId: filters.workflowId,
      });
    }

    if (filters.workflowVersion !== undefined) {
      queryBuilder.andWhere('workflowVersion.version = :workflowVersion', {
        workflowVersion: filters.workflowVersion,
      });
    }

    if (filters.currentStep !== undefined) {
      queryBuilder.andWhere('onboarding.currentStep = :currentStep', {
        currentStep: filters.currentStep,
      });
    }

    if (filters.onboardingId !== undefined) {
      queryBuilder.andWhere('onboarding.id = :onboardingId', {
        onboardingId: filters.onboardingId,
      });
    }

    // Coalesced rather than compared straight: an onboarding holding no link rows produces no
    // view row at all, and a plain equality would drop it out of every filtered page including
    // the `not_accepted` one it belongs on. The value is bound, never interpolated.
    if (filters.agreementStatus !== undefined) {
      queryBuilder.andWhere(
        'COALESCE(agreementStatusView.agreementStatus, :notAcceptedAgreementStatus) = :agreementStatus',
        {
          notAcceptedAgreementStatus: NOT_ACCEPTED_AGREEMENT_STATUS,
          agreementStatus: filters.agreementStatus,
        },
      );
    }

    // The park is jsonb, so its keys are read with the `->>` operator; the column name is the
    // entity's, and every value is bound.
    if (filters.parked !== undefined) {
      queryBuilder.andWhere(
        filters.parked
          ? 'onboarding.pending_connector IS NOT NULL'
          : 'onboarding.pending_connector IS NULL',
      );
    }

    if (filters.pendingConnectorId !== undefined) {
      queryBuilder.andWhere(
        "onboarding.pending_connector ->> 'connectorId' = :pendingConnectorId",
        {
          pendingConnectorId: filters.pendingConnectorId,
        },
      );
    }

    if (filters.parkedBefore !== undefined) {
      queryBuilder.andWhere(
        "(onboarding.pending_connector ->> 'parkedAt')::timestamptz < :parkedBefore",
        { parkedBefore: filters.parkedBefore },
      );
    }
  }

  /**
   * The reads that report an onboarding to an operator, with the derived agreement status joined
   * in. `paginateQueryBuilder` finishes on `getMany()`, so the status has to arrive as a mapped
   * entity — an `addSelect` of a raw expression would be dropped — and the join is what gives
   * `andWhere` a real column to filter on. `workflowVersion` and its own `workflow` are joined too:
   * both are required relations, so `getWorkflowKey()`/`getWorkflowVersionNumber()` would throw on
   * every reader otherwise.
   *
   * The two workflow joins name their columns rather than selecting the relations whole.
   * `workflow_versions.definition` holds the entire authored workflow document — tens of
   * kilobytes — and `…AndSelect` would fetch, transfer and hydrate one copy of it per row of a
   * page that can hold a hundred, to read a version number and a name. The primary keys are
   * selected alongside them because they are what the result transformer builds the relation
   * objects from.
   */
  private createReadQueryBuilder(manager: EntityManager): SelectQueryBuilder<OnboardingEntity> {
    return this.createWorkflowQueryBuilder(manager).leftJoinAndMapOne(
      'onboarding.agreementStatusView',
      OnboardingAgreementStatusView,
      'agreementStatusView',
      'agreementStatusView.onboardingId = onboarding.id',
    );
  }

  /** The read query with its two workflow joins but without the agreement-status view. */
  private createWorkflowQueryBuilder(manager: EntityManager): SelectQueryBuilder<OnboardingEntity> {
    return manager
      .getRepository(OnboardingEntity)
      .createQueryBuilder('onboarding')
      .innerJoin('onboarding.workflowVersion', 'workflowVersion')
      .innerJoin('workflowVersion.workflow', 'workflow')
      .addSelect([
        'workflowVersion.workflowVersionId',
        'workflowVersion.version',
        'workflow.workflowId',
        'workflow.key',
      ]);
  }
}
