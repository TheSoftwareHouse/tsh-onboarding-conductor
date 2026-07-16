import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  OnboardingRuntimePort,
  RuntimeInputFailure,
  RuntimeSuccessResult,
  WorkflowNotFoundError,
} from '../runtime/onboarding-runtime.port';
import { OnboardingEntity } from './onboarding.entity';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

describe('OnboardingsService', () => {
  const manager = {} as EntityManager;

  const createOnboarding = (overrides: Partial<OnboardingEntity> = {}): OnboardingEntity =>
    Object.assign(new OnboardingEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ab',
      workflowId: 'passport-check',
      workflowVersion: 3,
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: {},
      expiresAt: null,
      completedAt: null,
      ...overrides,
    });

  const createHarness = (
    onboarding?: OnboardingEntity,
    runtimeOverrides: Partial<OnboardingRuntimePort> = {},
  ) => {
    const transaction = jest.fn(async (callback: (tx: EntityManager) => unknown) =>
      callback(manager),
    );
    const dataSource = { transaction } as unknown as DataSource;
    const repository = {
      createInitial: jest.fn(),
      findByIdForUpdate: jest.fn().mockResolvedValue(onboarding ?? null),
      saveLocked: jest.fn().mockImplementation(async (_tx, entity) => entity),
    } as unknown as OnboardingsRepository;
    const runtime: OnboardingRuntimePort = {
      initialize: jest.fn().mockReturnValue({
        success: true,
        workflowId: 'passport-check',
        workflowVersion: 3,
        persistedCurrentStep: null,
        acceptedData: {},
        appliedStep: 'capture_alias',
        targetState: { status: 'awaiting_user', currentStep: 'capture_alias' },
        terminal: false,
      } satisfies RuntimeSuccessResult),
      evaluate: jest.fn().mockReturnValue({
        success: true,
        workflowId: 'passport-check',
        workflowVersion: 3,
        persistedCurrentStep: 'capture_alias',
        acceptedData: { contactAddress: 'person@example.com' },
        appliedStep: 'capture_alias',
        targetState: { status: 'awaiting_user', currentStep: 'confirm_identity' },
        terminal: false,
      } satisfies RuntimeSuccessResult),
      ...runtimeOverrides,
    };

    return {
      service: new OnboardingsService(dataSource, repository, runtime),
      transaction,
      repository,
      runtime,
    };
  };

  it('creates the initial row in a transaction and returns the initial state', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const response = await harness.service.start({ workflowId: 'unused-name' });

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.runtime.initialize).toHaveBeenCalledWith({
      workflowId: 'unused-name',
      workflowVersion: 1,
    });
    expect(harness.repository.createInitial).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        id: response.onboardingId,
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        context: {},
        expiresAt: null,
        completedAt: null,
      }),
    );
    expect(response).toEqual({
      onboardingId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      expiresAt: null,
    });
  });

  it('returns distinct ids for separate accepted starts', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const first = await harness.service.start({ workflowId: 'first' });
    const second = await harness.service.start({ workflowId: 'second' });

    expect(first.onboardingId).not.toBe(second.onboardingId);
    expect(harness.repository.createInitial).toHaveBeenCalledTimes(2);
  });

  it('does not generate an id or persist when workflow initialization fails', async () => {
    const harness = createHarness(undefined, {
      initialize: jest.fn().mockImplementation(() => {
        throw new WorkflowNotFoundError();
      }),
    });

    await expect(harness.service.start({ workflowId: 'missing' })).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_NOT_FOUND',
        message: 'WORKFLOW_NOT_FOUND',
      },
      status: 404,
    });
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.repository.createInitial).not.toHaveBeenCalled();
  });

  it('returns the stable not-found error for an unknown onboarding', async () => {
    const harness = createHarness();

    await expect(harness.service.submit('missing', {})).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_NOT_FOUND',
        message: 'ONBOARDING_NOT_FOUND',
      },
    });
    expect(harness.repository.findByIdForUpdate).toHaveBeenCalledWith(manager, 'missing');
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
  });

  it('delegates locked lookup and runtime evaluation, then persists accepted data', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness(onboarding);

    const first = await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });
    expect(first).toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
    });
    expect(harness.runtime.evaluate).toHaveBeenCalledWith({
      workflowId: 'passport-check',
      workflowVersion: 3,
      currentStep: 'capture_alias',
      submittedData: { contactAddress: 'person@example.com' },
    });
    expect(harness.repository.findByIdForUpdate).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });

    (harness.runtime.evaluate as jest.Mock).mockReturnValueOnce({
      success: true,
      workflowId: 'passport-check',
      workflowVersion: 3,
      persistedCurrentStep: 'confirm_identity',
      acceptedData: { identityConfirmed: true },
      appliedStep: 'confirm_identity',
      targetState: { status: 'approved', currentStep: null },
      terminal: true,
    } satisfies RuntimeSuccessResult);
    const second = await harness.service.submit('onboarding-id', {
      identityConfirmed: true,
    });
    expect(second).toEqual({
      appliedStep: 'confirm_identity',
      status: 'approved',
      currentStep: null,
    });
    expect(onboarding.context).toEqual({
      contactAddress: 'person@example.com',
      identityConfirmed: true,
    });
    expect(onboarding.completedAt).toBeInstanceOf(Date);
    expect(harness.transaction).toHaveBeenCalledTimes(2);
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid runtime results without saving or mutating the entity', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const failure: RuntimeInputFailure = {
      success: false,
      code: 'INVALID_STEP_DATA',
      acceptedData: {},
    };
    const harness = createHarness(onboarding, {
      evaluate: jest.fn().mockReturnValue(failure),
    });
    const before = { ...onboarding, context: { ...onboarding.context } };

    const error = await harness.service
      .submit('onboarding-id', { contactAddress: 'invalid' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error).toMatchObject({
      response: { code: 'INVALID_STEP_DATA', message: 'INVALID_STEP_DATA' },
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(onboarding).toEqual(before);
  });

  it('rejects completed onboarding without invoking the runtime or saving', async () => {
    const onboarding = createOnboarding({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
      completedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    const harness = createHarness(onboarding);
    await expect(
      harness.service.submit('onboarding-id', { identityConfirmed: true }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.runtime.evaluate).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(onboarding).toMatchObject({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
    });
  });
});
