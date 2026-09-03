import { EntityManager } from 'typeorm';
import { paginateQueryBuilder, resolvePaginationWindow, type PaginatedResult } from '../pagination';
import { OnboardingEntity } from './entity/onboarding.entity';
import {
  DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
  DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
  ListAdminOnboardingsQueryDto,
} from './dto/list-admin-onboardings.query.dto';

export interface InitialOnboardingData {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: OnboardingEntity['status'];
  currentStep: string | null;
  context: Record<string, unknown>;
  score: number;
  scoreByStep: Record<string, number>;
  expiresAt: Date | null;
  completedAt: Date | null;
  rejectionReason: OnboardingEntity['rejectionReason'];
}

export class OnboardingsRepository {
  async findById(manager: EntityManager, id: string): Promise<OnboardingEntity | null> {
    return manager.getRepository(OnboardingEntity).findOne({ where: { id } });
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
      workflowId: persistedOnboarding.workflowId,
      workflowVersion: persistedOnboarding.workflowVersion,
      status: persistedOnboarding.status,
      currentStep: persistedOnboarding.currentStep,
      context: persistedOnboarding.context,
      // Both must be copied back, or a concurrent submit silently reverts the score it just wrote.
      score: persistedOnboarding.score,
      scoreByStep: persistedOnboarding.scoreByStep,
      expiresAt: persistedOnboarding.expiresAt,
      createdAt: persistedOnboarding.createdAt,
      updatedAt: persistedOnboarding.updatedAt,
      completedAt: persistedOnboarding.completedAt,
      rejectionReason: persistedOnboarding.rejectionReason,
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
    const repository = manager.getRepository(OnboardingEntity);
    const queryBuilder = repository.createQueryBuilder('onboarding');

    if (filters.status !== undefined) {
      queryBuilder.andWhere('onboarding.status = :status', { status: filters.status });
    }

    if (filters.workflowId !== undefined) {
      queryBuilder.andWhere('onboarding.workflowId = :workflowId', {
        workflowId: filters.workflowId,
      });
    }

    if (filters.workflowVersion !== undefined) {
      queryBuilder.andWhere('onboarding.workflowVersion = :workflowVersion', {
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

    if (filters.minScore !== undefined) {
      queryBuilder.andWhere('onboarding.score >= :minScore', { minScore: filters.minScore });
    }

    if (filters.maxScore !== undefined) {
      queryBuilder.andWhere('onboarding.score <= :maxScore', { maxScore: filters.maxScore });
    }

    const sortField = filters.sortBy ?? DEFAULT_ADMIN_ONBOARDING_SORT_FIELD;
    const sortDirection =
      (filters.sortDir ?? DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION) === 'asc' ? 'ASC' : 'DESC';

    // `NULLS LAST` in both directions, rather than Postgres's default of last-on-ASC and
    // first-on-DESC: `completedAt` is nullable, and an operator asking for the most recently
    // completed onboardings does not want every unfinished one ahead of them.
    //
    // Every ordering keeps the id tie-break: without it, rows sharing a value would be returned in
    // whatever order the planner chose, and pagination would drop and repeat them across pages.
    queryBuilder
      .orderBy(`onboarding.${sortField}`, sortDirection, 'NULLS LAST')
      .addOrderBy('onboarding.id', 'DESC');

    return paginateQueryBuilder(queryBuilder, resolvePaginationWindow(filters));
  }
}
