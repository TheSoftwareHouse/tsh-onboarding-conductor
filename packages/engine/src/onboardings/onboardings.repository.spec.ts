import { EntityManager, Repository } from 'typeorm';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingsRepository } from './onboardings.repository';

describe('OnboardingsRepository', () => {
  const createHarness = () => {
    const repositoryMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as Repository<OnboardingEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repositoryMock),
    } as unknown as EntityManager;

    return { sut: new OnboardingsRepository(), manager, repositoryMock };
  };

  describe('lockAndRefreshPreflight', () => {
    it('copies scores from the locked row onto the in-memory entity', async () => {
      const harness = createHarness();
      const onboarding = Object.assign(new OnboardingEntity(), {
        id: 'onboarding-1',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'awaiting_user',
        currentStep: 'collect_profile',
        context: {},
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: null,
        rejectionReason: null,
        scores: {},
      });
      const persistedOnboarding = Object.assign(new OnboardingEntity(), {
        id: 'onboarding-1',
        workflowId: 'passport-check',
        workflowVersion: 1,
        status: 'awaiting_user',
        currentStep: 'collect_profile',
        context: {},
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:05:00.000Z'),
        completedAt: null,
        rejectionReason: null,
        scores: { risk: 40 },
      });
      (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(persistedOnboarding);

      await harness.sut.lockAndRefreshPreflight(harness.manager, onboarding);

      expect(onboarding.scores).toEqual({ risk: 40 });
    });
  });
});
