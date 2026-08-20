import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';
import { DocumentUploadService } from './document-upload.service';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingTransitionsService } from './onboarding-transitions.service';

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
      {} as OnboardingTransitionsService,
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
      {} as OnboardingTransitionsService,
    );

    await expect(controller.getState('onboarding-id')).resolves.toEqual(state);
    expect(onboardingStateService.getState).toHaveBeenCalledWith('onboarding-id');
  });

  it('reads one onboarding by the id in the route param', async () => {
    const summary = { onboardingId: 'onboarding-id', workflowId: 'base', workflowVersion: 1 };
    const onboardingsService = {
      getForAdmin: jest.fn().mockResolvedValue(summary),
    } as unknown as jest.Mocked<Pick<OnboardingsService, 'getForAdmin'>>;

    const controller = new OnboardingsController(
      onboardingsService as unknown as OnboardingsService,
      {} as DocumentUploadService,
      {} as OnboardingStateService,
      {} as OnboardingTransitionsService,
    );

    await expect(controller.getForAdmin('onboarding-id')).resolves.toBe(summary);
    expect(onboardingsService.getForAdmin).toHaveBeenCalledWith('onboarding-id');
  });

  it('reads the transitions of the onboarding in the route param', async () => {
    const trail = { items: [], meta: { truncated: false } };
    const onboardingTransitionsService = {
      listTransitions: jest.fn().mockResolvedValue(trail),
    } as unknown as jest.Mocked<Pick<OnboardingTransitionsService, 'listTransitions'>>;

    const controller = new OnboardingsController(
      {} as OnboardingsService,
      {} as DocumentUploadService,
      {} as OnboardingStateService,
      onboardingTransitionsService as unknown as OnboardingTransitionsService,
    );

    await expect(controller.listTransitions('onboarding-id')).resolves.toBe(trail);
    expect(onboardingTransitionsService.listTransitions).toHaveBeenCalledWith('onboarding-id');
  });
});
