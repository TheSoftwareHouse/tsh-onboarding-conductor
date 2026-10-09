import { describe, expect, it, vi } from 'vitest';
import { auditQueries } from '@/api/audit/audit-queries';
import { onboardingMutations, reviewInvalidationKeys } from './onboarding-mutations';
import { onboardingQueries } from './onboarding-queries';
import { reconcilePendingConnector } from './onboarding-reconcile';
import { submitOnboardingReview } from './onboarding-review';

vi.mock('./onboarding-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./onboarding-review')>()),
  submitOnboardingReview: vi.fn(),
}));

vi.mock('./onboarding-reconcile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./onboarding-reconcile')>()),
  reconcilePendingConnector: vi.fn(),
}));

describe('onboardingMutations.review', () => {
  it('invalidates the onboarding summary, the list and the audit trail', () => {
    const { meta } = onboardingMutations.review('onboarding-1');

    expect(meta).toEqual({
      invalidates: [
        onboardingQueries.detail('onboarding-1').queryKey,
        onboardingQueries.lists(),
        auditQueries.all(),
      ],
    });
  });

  it('shares its keys with the exported list', () => {
    expect(onboardingMutations.review('onboarding-1').meta?.invalidates).toEqual(
      reviewInvalidationKeys('onboarding-1'),
    );
  });

  it('submits the action for the factory onboarding', async () => {
    vi.mocked(submitOnboardingReview).mockResolvedValueOnce({
      status: 'approved',
      currentStep: null,
    });
    const { mutationFn } = onboardingMutations.review('onboarding-1');

    await mutationFn?.('approve', {} as never);

    expect(submitOnboardingReview).toHaveBeenCalledWith('onboarding-1', 'approve');
  });
});

describe('onboardingMutations.reconcile', () => {
  it('invalidates the trail, the list and the audit trail, never the summary the engine just answered', () => {
    const { meta } = onboardingMutations.reconcile('onboarding-1');

    expect(meta).toEqual({
      invalidates: [
        onboardingQueries.transitions('onboarding-1').queryKey,
        onboardingQueries.lists(),
        auditQueries.all(),
      ],
    });
  });

  it('asks the provider about the factory onboarding', async () => {
    vi.mocked(reconcilePendingConnector).mockResolvedValueOnce({} as never);
    const { mutationFn } = onboardingMutations.reconcile('onboarding-1');

    await mutationFn?.(undefined, {} as never);

    expect(reconcilePendingConnector).toHaveBeenCalledWith('onboarding-1');
  });
});
