import { Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuditService, OnboardingLifecycleTrail } from '../audit/audit.service';
import type { Workflow } from '../workflows/domain/workflow';
import type { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import type { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { OnboardingTransitionsService } from './onboarding-transitions.service';
import type { OnboardingsRepository } from './onboardings.repository';

const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';
const WORKFLOW_VERSION_ID = '018f1e2a-2222-7000-8000-000000000002';

const onboarding = {
  id: ONBOARDING_ID,
  workflowVersionId: WORKFLOW_VERSION_ID,
  getWorkflowKey: () => 'kyc-basic',
  getWorkflowVersionNumber: () => 2,
} as unknown as OnboardingEntity;

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'row-1',
  occurredAt: new Date('2026-07-01T10:00:00.000Z'),
  action: 'onboarding.state_transition' as const,
  metadata: {
    workflowId: 'kyc-basic',
    workflowVersion: 2,
    appliedStep: 'collect_documents',
    fromStatus: 'awaiting_user',
    toStatus: 'awaiting_manual_review',
    fromCurrentStep: 'collect_documents',
    toCurrentStep: 'review_documents',
    fromScores: null,
    toScores: {},
    ...((overrides.metadata as Record<string, unknown>) ?? {}),
  },
  ...overrides,
});

type Harness = {
  service: OnboardingTransitionsService;
  registry: { getByVersionId: jest.Mock };
  auditService: { listOnboardingLifecycle: jest.Mock };
};

function createService(options: {
  onboarding?: OnboardingEntity | null;
  trail?: OnboardingLifecycleTrail;
  workflow?: Partial<Workflow>;
  workflowError?: Error;
}): Harness {
  const manager = {} as EntityManager;
  const dataSource = { manager } as DataSource;
  const onboardingsRepository = {
    findById: jest
      .fn()
      .mockResolvedValue('onboarding' in options ? options.onboarding : onboarding),
  } as unknown as OnboardingsRepository;
  const auditService = {
    listOnboardingLifecycle: jest
      .fn()
      .mockResolvedValue(options.trail ?? { entries: [], truncated: false }),
  };
  const registry = {
    getByVersionId: options.workflowError
      ? jest.fn().mockRejectedValue(options.workflowError)
      : jest.fn().mockResolvedValue(options.workflow ?? { resolveEnteredStep: jest.fn() }),
  };

  return {
    service: new OnboardingTransitionsService(
      dataSource,
      onboardingsRepository,
      auditService as unknown as AuditService,
      registry as unknown as WorkflowRegistryService,
    ),
    registry,
    auditService,
  };
}

describe('OnboardingTransitionsService', () => {
  it('reports an id that matches no onboarding as not found', async () => {
    const { service } = createService({ onboarding: null });

    await expect(service.listTransitions(ONBOARDING_ID)).rejects.toThrow(
      OnboardingNotFoundException,
    );
  });

  it('reads the trail against the onboarding it was asked for, capped at one page', async () => {
    const { service, auditService } = createService({});

    await service.listTransitions(ONBOARDING_ID);

    expect(auditService.listOnboardingLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      ONBOARDING_ID,
      100,
    );
  });

  it('resolves each move against the revision the onboarding runs on', async () => {
    const resolveEnteredStep = jest.fn().mockReturnValue('review_documents');
    const { service, registry } = createService({
      trail: { entries: [entry()], truncated: false },
      workflow: { resolveEnteredStep } as unknown as Partial<Workflow>,
    });

    const response = await service.listTransitions(ONBOARDING_ID);

    expect(registry.getByVersionId).toHaveBeenCalledWith(WORKFLOW_VERSION_ID);
    expect(resolveEnteredStep).toHaveBeenCalledWith({
      status: 'awaiting_manual_review',
      fromStep: 'collect_documents',
      appliedStep: 'collect_documents',
      toStep: 'review_documents',
    });
    expect(response.items).toEqual([
      {
        id: 'row-1',
        occurredAt: new Date('2026-07-01T10:00:00.000Z'),
        status: 'awaiting_manual_review',
        fromStep: 'collect_documents',
        appliedStep: 'collect_documents',
        enteredStep: 'review_documents',
        trigger: null,
        current: true,
      },
    ]);
  });

  it('marks only the last recorded move as where the onboarding stands', async () => {
    const { service } = createService({
      trail: {
        entries: [entry({ id: 'row-1' }), entry({ id: 'row-2' }), entry({ id: 'row-3' })],
        truncated: false,
      },
      workflow: { resolveEnteredStep: () => 'review_documents' } as unknown as Partial<Workflow>,
    });

    const response = await service.listTransitions(ONBOARDING_ID);

    expect(response.items.map((item) => item.current)).toEqual([false, false, true]);
  });

  it('reports the manual trigger that drove an operator decision', async () => {
    const { service } = createService({
      trail: {
        entries: [entry({ metadata: { manualTrigger: 'manual.approve' } })],
        truncated: false,
      },
      workflow: { resolveEnteredStep: () => 'approved' } as unknown as Partial<Workflow>,
    });

    const response = await service.listTransitions(ONBOARDING_ID);

    expect(response.items[0].trigger).toBe('manual.approve');
  });

  it('passes on that the trail was clipped so a reader is not shown part of one as the whole', async () => {
    const { service } = createService({ trail: { entries: [], truncated: true } });

    await expect(service.listTransitions(ONBOARDING_ID)).resolves.toMatchObject({
      meta: { truncated: true },
    });
  });

  it('still answers the trail when the revision it ran on can no longer be read', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = createService({
      trail: {
        entries: [entry({ metadata: { toCurrentStep: null, toStatus: 'approved' } })],
        truncated: false,
      },
      workflowError: new WorkflowNotFoundException(),
    });

    const response = await service.listTransitions(ONBOARDING_ID);

    // The move is still reported; only the name of the terminal step it entered is lost.
    expect(response.items).toHaveLength(1);
    expect(response.items[0].enteredStep).toBeNull();
    expect(response.items[0].status).toBe('approved');
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
