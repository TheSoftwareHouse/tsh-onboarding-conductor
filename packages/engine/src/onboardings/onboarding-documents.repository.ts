import { EntityManager } from 'typeorm';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';

export class OnboardingDocumentsRepository {
  async createPendingReservation(
    manager: EntityManager,
    document: OnboardingDocumentEntity,
  ): Promise<OnboardingDocumentEntity> {
    const repository = manager.getRepository(OnboardingDocumentEntity);
    return repository.save(repository.create(document));
  }

  async findById(manager: EntityManager, id: string): Promise<OnboardingDocumentEntity | null> {
    return manager.getRepository(OnboardingDocumentEntity).findOne({
      where: { id },
    });
  }

  async findByIdForUpdate(
    manager: EntityManager,
    id: string,
  ): Promise<OnboardingDocumentEntity | null> {
    return manager.getRepository(OnboardingDocumentEntity).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findPendingByOnboardingStepAndField(
    manager: EntityManager,
    onboardingId: string,
    stepName: string,
    fieldName: string,
  ): Promise<OnboardingDocumentEntity | null> {
    return manager.getRepository(OnboardingDocumentEntity).findOne({
      where: {
        onboardingId,
        stepName,
        fieldName,
        status: 'pending',
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async markExpired(
    manager: EntityManager,
    document: OnboardingDocumentEntity,
  ): Promise<OnboardingDocumentEntity> {
    const repository = manager.getRepository(OnboardingDocumentEntity);
    document.status = 'expired';
    return repository.save(document);
  }

  async markCompleted(
    manager: EntityManager,
    document: OnboardingDocumentEntity,
  ): Promise<OnboardingDocumentEntity> {
    const repository = manager.getRepository(OnboardingDocumentEntity);
    document.status = 'completed';
    document.completedAt = new Date();
    return repository.save(document);
  }
}
