import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import { AuditService } from '../audit/audit.service';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { WorkflowRevisionNotFoundError } from '../workflows/errors/workflow-revision-not-found.error';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import {
  buildOnboardingsCsvColumns,
  CSV_BOM,
  type OnboardingsCsvColumns,
  toOnboardingsCsvHeader,
  toOnboardingsCsvRow,
} from './domain/onboardings-csv';
import type { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingsRepository, type AdminOnboardingFilters } from './onboardings.repository';

// The status lookup binds one parameter per id, and Postgres refuses more than 65,535 in a query.
const EXPORT_BATCH_SIZE = 5000;

@Injectable()
export class OnboardingsExportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly auditService: AuditService,
  ) {}

  /** Resolves the columns, audits the export by `actorId`, then hands back the CSV stream. */
  async exportCsv(
    filters: AdminOnboardingFilters,
    actorId: string,
  ): Promise<AsyncGenerator<string>> {
    const columns = await this.resolveColumns(filters);

    await this.auditService.logOnboardingsExport(this.dataSource, { actorId, filters });

    return this.streamCsv(filters, columns);
  }

  private async resolveColumns(filters: AdminOnboardingFilters): Promise<OnboardingsCsvColumns> {
    const versions = await this.onboardingsRepository.findWorkflowVersionsForAdmin(
      this.dataSource.manager,
      filters,
    );
    const definitions: NormalizedWorkflowDefinition[] = [];

    for (const { workflowKey, version } of versions) {
      try {
        definitions.push(
          await this.workflowRegistryService.getDefinitionForAdmin(workflowKey, version),
        );
      } catch (error: unknown) {
        // A version outside the active scopes contributes no columns; its context lands in `Other data`.
        if (
          !(error instanceof WorkflowNotFoundException) &&
          !(error instanceof WorkflowRevisionNotFoundError)
        ) {
          throw error;
        }
      }
    }

    return buildOnboardingsCsvColumns(definitions);
  }

  /** Read outside a transaction, like the list: a long export must not hold one open. */
  private async *streamCsv(
    filters: AdminOnboardingFilters,
    columns: OnboardingsCsvColumns,
  ): AsyncGenerator<string> {
    const manager = this.dataSource.manager;

    yield CSV_BOM + toOnboardingsCsvHeader(columns);

    let afterId: string | null = null;
    let batch: OnboardingEntity[];

    do {
      batch = await this.onboardingsRepository.findAdminExportBatch(
        manager,
        filters,
        afterId,
        EXPORT_BATCH_SIZE,
      );

      if (batch.length > 0) {
        afterId = batch[batch.length - 1].id;
        yield batch
          .map((onboarding) =>
            toOnboardingsCsvRow(
              {
                onboardingId: onboarding.id,
                workflowId: onboarding.getWorkflowKey(),
                workflowVersion: onboarding.getWorkflowVersionNumber(),
                status: onboarding.status,
                currentStep: onboarding.currentStep,
                agreementStatus: onboarding.getAgreementStatus(),
                rejectionReason: onboarding.rejectionReason,
                createdAt: onboarding.createdAt,
                updatedAt: onboarding.updatedAt,
                completedAt: onboarding.completedAt,
                scores: onboarding.scores,
                context: onboarding.context,
              },
              columns,
            ),
          )
          .join('');
      }
    } while (batch.length === EXPORT_BATCH_SIZE);
  }
}
