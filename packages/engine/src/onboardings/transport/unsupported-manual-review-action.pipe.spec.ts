import { BadRequestException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { isAuditRecorded } from '../../audit/audit-recorded.marker';
import { UnsupportedManualReviewActionPipe } from './unsupported-manual-review-action.pipe';

describe('UnsupportedManualReviewActionPipe', () => {
  it('logs a rejected attempt, marks the exception as audited, and throws without carrying the raw action', async () => {
    const dataSource = {} as DataSource;
    const auditService = {
      logRejectedAttempt: jest.fn().mockResolvedValue(undefined),
    } as Partial<AuditService> as AuditService;
    const pipe = new UnsupportedManualReviewActionPipe(dataSource, auditService, {} as never);

    let caught: unknown;
    try {
      await pipe.transform({ id: 'onboarding-id', action: 'return' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      message: ['action must be one of the following values: approve, reject, invalid'],
      error: 'Bad Request',
    });
    expect(isAuditRecorded(caught)).toBe(true);

    expect(auditService.logRejectedAttempt).toHaveBeenCalledWith(dataSource, {
      operation: 'manual_review',
      outcome: 'unsupported_action',
      resourceId: 'onboarding-id',
    });
  });

  it('leaves the exception unmarked and logs a warning when the audit write rejects', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const dataSource = {} as DataSource;
    const auditService = {
      logRejectedAttempt: jest.fn().mockRejectedValue(new Error('write failed')),
    } as Partial<AuditService> as AuditService;
    const pipe = new UnsupportedManualReviewActionPipe(dataSource, auditService, {} as never);

    let caught: unknown;
    try {
      await pipe.transform({ id: 'onboarding-id', action: 'return' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      message: ['action must be one of the following values: approve, reject, invalid'],
      error: 'Bad Request',
    });
    expect(isAuditRecorded(caught)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onboarding-id'));

    warnSpy.mockRestore();
  });

  it('leaves the exception unmarked when the onboarding id is not a string', async () => {
    const auditService = {
      logRejectedAttempt: jest.fn(),
    } as Partial<AuditService> as AuditService;
    const pipe = new UnsupportedManualReviewActionPipe({} as DataSource, auditService, {
      params: {},
    } as never);

    let caught: unknown;
    try {
      await pipe.transform({ action: 'return' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect(isAuditRecorded(caught)).toBe(false);
    expect(auditService.logRejectedAttempt).not.toHaveBeenCalled();
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
