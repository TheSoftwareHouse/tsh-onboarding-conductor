import { EntityManager } from 'typeorm';
import { paginateQueryBuilder, resolvePaginationWindow, type PaginatedResult } from '../pagination';
import { OnboardingEntity } from './entity/onboarding.entity';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';

export interface InitialOnboardingData {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: OnboardingEntity['status'];
  currentStep: string | null;
  context: Record<string, unknown>;
  expiresAt: Date | null;
  completedAt: Date | null;
  rejectionReason: OnboardingEntity['rejectionReason'];
  scores: Record<string, number>;
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
      expiresAt: persistedOnboarding.expiresAt,
      createdAt: persistedOnboarding.createdAt,
      updatedAt: persistedOnboarding.updatedAt,
      completedAt: persistedOnboarding.completedAt,
      rejectionReason: persistedOnboarding.rejectionReason,
      scores: persistedOnboarding.scores,
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

    queryBuilder.orderBy('onboarding.createdAt', 'DESC').addOrderBy('onboarding.id', 'DESC');

    return paginateQueryBuilder(queryBuilder, resolvePaginationWindow(filters));
  }
}
