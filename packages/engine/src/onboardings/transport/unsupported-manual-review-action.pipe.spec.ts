import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { UnsupportedManualReviewActionPipe } from './unsupported-manual-review-action.pipe';

describe('UnsupportedManualReviewActionPipe', () => {
  it('logs a rejected attempt and throws for unsupported actions without carrying the raw action', async () => {
    const dataSource = {} as DataSource;
    const auditService = {
      logRejectedAttempt: jest.fn().mockResolvedValue(undefined),
    } as Partial<AuditService> as AuditService;
    const pipe = new UnsupportedManualReviewActionPipe(dataSource, auditService, {} as never);

    await expect(pipe.transform({ id: 'onboarding-id', action: 'return' })).rejects.toThrow(
      BadRequestException,
    );

    expect(auditService.logRejectedAttempt).toHaveBeenCalledWith(dataSource, {
      operation: 'manual_review',
      outcome: 'unsupported_action',
      resourceId: 'onboarding-id',
    });
  });

  it('passes through supported actions', async () => {
    const pipe = new UnsupportedManualReviewActionPipe(
      {} as DataSource,
      {} as AuditService,
      {} as never,
    );

    await expect(pipe.transform({ id: 'onboarding-id', action: 'approve' })).resolves.toEqual({
      id: 'onboarding-id',
      action: 'approve',
    });
  });
});
