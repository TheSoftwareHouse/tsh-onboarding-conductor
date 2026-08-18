import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingStateService } from './onboarding-state.service';

describe('OnboardingsController', () => {
  it('calls manualReview with the onboarding id and validated trigger from route params', async () => {
    const onboardingsService = {
      manualReview: jest.fn().mockResolvedValue({
        appliedStep: 'awaiting_manual_review',
        status: 'approved',
        currentStep: null,
      }),
    } as unknown as jest.Mocked<Pick<OnboardingsService, 'manualReview'>>;
    const documentUploadService = {} as DocumentUploadService;

    const controller = new OnboardingsController(
      onboardingsService as unknown as OnboardingsService,
      documentUploadService,
      {} as OnboardingStateService,
    );

    await expect(controller.review({ id: 'onboarding-id', action: 'approve' })).resolves.toEqual({
      appliedStep: 'awaiting_manual_review',
      status: 'approved',
      currentStep: null,
    });
    expect(onboardingsService.manualReview).toHaveBeenCalledWith('onboarding-id', 'manual.approve');
  });
  it('calls getState with the onboarding id from the route param', async () => {
    const state = {
      onboardingId: 'onboarding-id',
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user' as const,
      currentStep: 'collect_email',
      terminal: false,
      rejectionReason: null,
      step: null,
    };
    const onboardingStateService = {
      getState: jest.fn().mockResolvedValue(state),
    } as unknown as jest.Mocked<Pick<OnboardingStateService, 'getState'>>;

    const controller = new OnboardingsController(
      {} as OnboardingsService,
      {} as DocumentUploadService,
      onboardingStateService as unknown as OnboardingStateService,
    );

    await expect(controller.getState('onboarding-id')).resolves.toEqual(state);
    expect(onboardingStateService.getState).toHaveBeenCalledWith('onboarding-id');
  });
});
