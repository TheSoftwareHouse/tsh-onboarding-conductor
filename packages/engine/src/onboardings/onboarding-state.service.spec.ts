import { DataSource } from 'typeorm';
import type { StepDescription } from '../workflows/domain/step';
import { Workflow } from '../workflows/domain/workflow';
import { WorkflowEntity } from '../workflows/entity/workflow.entity';
import { WorkflowVersionEntity } from '../workflows/entity/workflow-version.entity';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingsRepository } from './onboardings.repository';

describe('OnboardingStateService', () => {
  const stepDescription: StepDescription = {
    name: 'collect_details',
    status: 'awaiting_user',
    canSubmit: true,
    fields: [
      {
        name: 'taxId',
        type: 'text',
        required: true,
        active: true,
        dependsOn: ['country'],
        when: { field: 'country', equals: 'US' },
        schema: { type: 'string' },
        value: null,
      },
    ],
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { taxId: { type: 'string' } },
      required: ['taxId'],
    },
  };

  const workflowVersionId = '01912345-6789-7abc-8def-00000000f001';

  const createOnboarding = (overrides: Partial<OnboardingEntity> = {}) =>
    Object.assign(new OnboardingEntity(), {
      id: 'onboarding-id',
      workflowVersionId,
      workflowVersion: Object.assign(new WorkflowVersionEntity(), {
        workflowVersionId,
        version: 1,
        workflow: Object.assign(new WorkflowEntity(), {
          key: 'conditional-fields-and-transitions',
        }),
      }),
      status: 'awaiting_user',
      currentStep: 'collect_details',
      context: { country: 'US' },
      rejectionReason: null,
      ...overrides,
    });

  const createService = (onboarding: OnboardingEntity | null, findStepDescription: jest.Mock) => {
    const dataSource = { manager: {} } as unknown as DataSource;
    const onboardingsRepository = {
      findById: jest.fn().mockResolvedValue(onboarding),
    } as unknown as jest.Mocked<Pick<OnboardingsRepository, 'findById'>>;
    const workflowRegistryService = {
      getByVersionId: jest.fn().mockReturnValue({ findStepDescription } as unknown as Workflow),
    } as unknown as jest.Mocked<Pick<WorkflowRegistryService, 'getByVersionId'>>;

    return {
      service: new OnboardingStateService(
        dataSource,
        onboardingsRepository as unknown as OnboardingsRepository,
        workflowRegistryService as unknown as WorkflowRegistryService,
      ),
      onboardingsRepository,
      workflowRegistryService,
    };
  };

  it('projects the renderable step for the persisted workflow version and context', async () => {
    const findStepDescription = jest.fn().mockReturnValue(stepDescription);
    const { service, workflowRegistryService } = createService(
      createOnboarding(),
      findStepDescription,
    );

    await expect(service.getState('onboarding-id')).resolves.toEqual({
      onboardingId: 'onboarding-id',
      workflowId: 'conditional-fields-and-transitions',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_details',
      terminal: false,
      rejectionReason: null,
      step: stepDescription,
    });
    expect(workflowRegistryService.getByVersionId).toHaveBeenCalledWith(workflowVersionId);
    expect(findStepDescription).toHaveBeenCalledWith('collect_details', { country: 'US' });
  });

  it('reports a terminal onboarding without a step to render', async () => {
    const { service } = createService(
      createOnboarding({
        status: 'rejected',
        currentStep: null,
        rejectionReason: 'CONNECTOR_REJECTED',
      }),
      jest.fn().mockReturnValue(undefined),
    );

    await expect(service.getState('onboarding-id')).resolves.toEqual(
      expect.objectContaining({
        status: 'rejected',
        currentStep: null,
        terminal: true,
        rejectionReason: 'CONNECTOR_REJECTED',
        step: null,
      }),
    );
  });

  it('throws the stable not-found error for an unknown onboarding', async () => {
    const { service } = createService(null, jest.fn());

    await expect(service.getState('missing-id')).rejects.toBeInstanceOf(
      OnboardingNotFoundException,
    );
  });
});
