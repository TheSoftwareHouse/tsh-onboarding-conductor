import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';
import { DocumentUploadService } from './document-upload.service';

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
    );

    await expect(
      controller.review({ id: 'onboarding-id', action: 'approve' }, { action: 'approve' }),
    ).resolves.toEqual({
      appliedStep: 'awaiting_manual_review',
      status: 'approved',
      currentStep: null,
    });
    expect(onboardingsService.manualReview).toHaveBeenCalledWith('onboarding-id', 'manual.approve');
  });
});
