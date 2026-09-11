import { BadRequestException, Injectable, Logger, PipeTransform, Scope } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { markAuditRecorded } from '../../audit/audit-recorded.marker';

const SUPPORTED_MANUAL_REVIEW_ACTIONS = new Set(['approve', 'reject', 'invalid']);

type ManualReviewRequest = Request & {
  params?: Record<string, string | undefined>;
};

type ManualReviewRouteParams = {
  id?: string;
  action?: string;
};

@Injectable({ scope: Scope.REQUEST })
export class UnsupportedManualReviewActionPipe implements PipeTransform<unknown> {
  private readonly logger = new Logger(UnsupportedManualReviewActionPipe.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @Inject(REQUEST) private readonly request: ManualReviewRequest,
  ) {}

  async transform(value: unknown): Promise<unknown> {
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const routeParams = value as ManualReviewRouteParams;
    const action = routeParams.action;

    if (typeof action !== 'string' || SUPPORTED_MANUAL_REVIEW_ACTIONS.has(action)) {
      return value;
    }

    const onboardingId = routeParams.id ?? this.request.params?.id;
    const auditRecorded =
      typeof onboardingId === 'string' && (await this.logRejectedAttempt(onboardingId));

    const exception = new BadRequestException([
      'action must be one of the following values: approve, reject, invalid',
    ]);

    throw auditRecorded ? markAuditRecorded(exception) : exception;
  }

  /** Best effort only; preserve the original validation failure regardless of outcome. */
  private async logRejectedAttempt(onboardingId: string): Promise<boolean> {
    try {
      await this.auditService.logRejectedAttempt(this.dataSource, {
        operation: 'manual_review',
        outcome: 'unsupported_action',
        resourceId: onboardingId,
      });

      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to log rejected manual review attempt for onboarding ${onboardingId}: ${error}`,
      );

      return false;
    }
  }
}
