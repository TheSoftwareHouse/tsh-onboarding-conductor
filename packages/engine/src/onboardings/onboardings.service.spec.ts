import { NotFoundException } from '@nestjs/common';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { OnboardingsService } from './onboardings.service';
import * as uuidUtil from '../utils/uuid.util';

describe('OnboardingsService', () => {
  it('resolves the workflow before generating an id', () => {
    const generateId = jest.spyOn(uuidUtil, 'generateUuidV7');
    const registry = {
      findById: jest.fn().mockReturnValue(undefined),
    } as unknown as WorkflowRegistryService;
    const service = new OnboardingsService(registry);

    expect(() => service.start({ flowId: 'unknown' })).toThrow(NotFoundException);
    expect(registry.findById).toHaveBeenCalledWith('unknown');
    expect(generateId).not.toHaveBeenCalled();
  });

  it('returns the terminal response for the empty base flow', () => {
    const service = new OnboardingsService(new WorkflowRegistryService());

    expect(service.start({ flowId: 'base' })).toEqual({
      onboardingId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'approved',
      currentStep: null,
      expiresAt: null,
    });
  });

  it('returns distinct ids for separate accepted starts', () => {
    const service = new OnboardingsService(new WorkflowRegistryService());

    const first = service.start({ flowId: 'base' });
    const second = service.start({ flowId: 'base' });

    expect(first.onboardingId).not.toBe(second.onboardingId);
  });

  it('throws a stable not-found code and message for an unknown flow', () => {
    const service = new OnboardingsService(new WorkflowRegistryService());

    try {
      service.start({ flowId: 'unknown' });
      throw new Error('Expected start to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'WORKFLOW_NOT_FOUND',
      });
    }
  });
});
