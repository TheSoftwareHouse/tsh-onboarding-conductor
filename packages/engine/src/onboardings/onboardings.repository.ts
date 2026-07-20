import { EntityManager } from 'typeorm';
import { OnboardingEntity } from './entity/onboarding.entity';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';

export interface InitialOnboardingData {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string | null;
  context: Record<string, unknown>;
  expiresAt: Date | null;
  completedAt: Date | null;
}

export class OnboardingsRepository {
  async createInitial(
    manager: EntityManager,
    data: InitialOnboardingData,
  ): Promise<OnboardingEntity> {
    const repository = manager.getRepository(OnboardingEntity);
    const onboarding = repository.create(data);

    return repository.save(onboarding);
  }

  async findByIdForUpdate(manager: EntityManager, id: string): Promise<OnboardingEntity | null> {
    return manager.getRepository(OnboardingEntity).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
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
  ): Promise<OnboardingEntity[]> {
    const repository = manager.getRepository(OnboardingEntity);
    const queryBuilder = repository.createQueryBuilder('onboarding');

    if (filters.status) {
      queryBuilder.andWhere('onboarding.status = :status', { status: filters.status });
    }

    if (filters.workflowId) {
      queryBuilder.andWhere('onboarding.workflowId = :workflowId', {
        workflowId: filters.workflowId,
      });
    }

    return queryBuilder
      .orderBy('onboarding.createdAt', 'DESC')
      .addOrderBy('onboarding.id', 'DESC')
      .getMany();
  }
}
