import { AzureJwtGuard } from '../auth/azure-jwt.guard';
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

  describe('the onboarding-scoped agreement routes', () => {
    const createController = (onboardingsService: Partial<OnboardingsService>) =>
      new OnboardingsController(
        onboardingsService as OnboardingsService,
        {} as DocumentUploadService,
        {} as OnboardingStateService,
        {} as OnboardingTransitionsService,
      );

    it('lists the agreements of the onboarding in the route param', async () => {
      const report = { onboardingId: 'onboarding-id', items: [] };
      const listAgreements = jest.fn().mockResolvedValue(report);
      const controller = createController({ listAgreements });

      await expect(controller.listAgreements('onboarding-id')).resolves.toBe(report);
      expect(listAgreements).toHaveBeenCalledWith('onboarding-id');
    });

    it('links the agreement the body names to the onboarding in the route param', async () => {
      const link = {
        onboardingId: 'onboarding-id',
        agreementId: 'agreement-id',
        key: 'eu-b2c-terms',
        version: 2,
        created: true,
      };
      const linkAgreement = jest.fn().mockResolvedValue(link);
      const controller = createController({ linkAgreement });

      await expect(
        controller.linkAgreement('onboarding-id', { agreementId: 'agreement-id' }),
      ).resolves.toBe(link);
      expect(linkAgreement).toHaveBeenCalledWith('onboarding-id', 'agreement-id');
    });

    it('accepts the agreement both route params name', async () => {
      const acceptance = {
        onboardingId: 'onboarding-id',
        agreementId: 'agreement-id',
        key: 'eu-b2c-terms',
        version: 2,
        acceptedAt: '2026-03-01T00:00:00.000Z',
      };
      const acceptAgreement = jest.fn().mockResolvedValue(acceptance);
      const controller = createController({ acceptAgreement });

      await expect(controller.acceptAgreement('onboarding-id', 'agreement-id')).resolves.toBe(
        acceptance,
      );
      expect(acceptAgreement).toHaveBeenCalledWith('onboarding-id', 'agreement-id');
    });

    // The guard placement is the security decision this feature turns on: linking and reading are
    // operator actions, while accepting is the end user's own, from a flow that holds no Entra
    // identity. Read off the metadata rather than trusted to a reviewer's eye.
    it.each([
      ['listAgreements', true],
      ['linkAgreement', true],
      ['acceptAgreement', false],
    ])('guards %s with the admin token: %s', (handler, guarded) => {
      const guards = Reflect.getMetadata(
        '__guards__',
        OnboardingsController.prototype[handler as keyof OnboardingsController],
      );

      expect((guards ?? []).includes(AzureJwtGuard)).toBe(guarded);
    });
  });
});
