import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { type AgreementLinkOrigin } from '../audit/audit.types';
import { isUniqueViolation } from '../database/unique-violation';
import {
  OnboardingAgreementsRepository,
  type AgreementFanOutOnboarding,
} from '../onboardings/onboarding-agreements.repository';
import { type PaginatedResult } from '../pagination';
import { WebhookService } from '../webhook/webhook.service';
import { Workflow } from '../workflows/domain/workflow';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { type AgreementType } from './agreement.types';
import { AgreementsRepository } from './agreements.repository';
import { ListAgreementsQueryDto } from './dto/list-agreements.query.dto';
import { AgreementVersionEntity } from './entity/agreement-version.entity';
import { AgreementNotFoundException } from './errors/agreement-not-found.exception';
import { AgreementVersionConflictException } from './errors/agreement-version-conflict.exception';

/** The constraint that guards one version per family. */
const AGREEMENT_VERSION_CONSTRAINT = 'uq_agreement_versions_agreement_version';

/** A published version together with how far its automatic fan-out reached. */
export type PublishedAgreement = {
  agreement: AgreementVersionEntity;
  /** Onboardings this publish linked. Excludes any that already held the new version. */
  linkedOnboardings: number;
};

/** One notification a publish owes once its transaction has committed. */
type PendingAgreementNotification = {
  onboarding: AgreementFanOutOnboarding;
  /** The version that onboarding did accept, which the event reports as what it is behind on. */
  previousAcceptedVersion: number;
};

/**
 * Publishing agreement versions, and the links onboardings hold against them.
 *
 * The single entry point for the rest of the engine: the onboardings module resolves families and
 * writes links through here rather than reaching into either repository, so the audit row that
 * must accompany a link cannot be forgotten at a call site.
 */
@Injectable()
export class AgreementsService {
  private readonly logger = new Logger(AgreementsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly agreementsRepository: AgreementsRepository,
    private readonly onboardingAgreementsRepository: OnboardingAgreementsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly webhookService: WebhookService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Publishes the next version of a family and links it, as `pending`, to every onboarding whose
   * highest accepted version is now behind.
   *
   * One transaction covers the whole decision - the insert with its family type check, the
   * fan-out's links and every audit row - because a link that survived a rolled-back version would owe an
   * agreement that does not exist. The notifications are enqueued only after that transaction
   * commits, from what the fan-out already returned: an outbox row written inside it would
   * announce an agreement nobody owes if the publish then failed.
   */
  async publish(key: string, type: AgreementType, operator: string): Promise<PublishedAgreement> {
    const published = await this.dataSource.transaction(async (manager) => {
      const agreement = await this.agreementsRepository
        .createNextVersion(manager, key, type)
        .catch((error: unknown) => {
          // Read off the driver error rather than caught in the repository: deriving the version
          // inside the INSERT is what keeps the number from going stale, and the price of that is
          // that two concurrent publishes on one family surface as a constraint violation.
          if (isUniqueViolation(error, AGREEMENT_VERSION_CONSTRAINT)) {
            throw new AgreementVersionConflictException(key);
          }

          throw error;
        });

      const notifications = await this.linkOnboardingsBehind(manager, agreement);

      await this.auditService.logAgreement(manager, {
        action: 'agreement.version_published',
        actorId: operator,
        resourceId: agreement.agreementVersionId,
        metadata: {
          key: agreement.agreement.key,
          type: agreement.agreement.type,
          version: agreement.version,
          linkedOnboardings: notifications.length,
        },
      });

      return { agreement, notifications };
    });

    await this.notifyPending(published.agreement, published.notifications);

    return {
      agreement: published.agreement,
      linkedOnboardings: published.notifications.length,
    };
  }

  /** Published versions for the admin listing, narrowed by whatever filters the query carries. */
  async list(query: ListAgreementsQueryDto): Promise<PaginatedResult<AgreementVersionEntity>> {
    return this.agreementsRepository.findForAdmin(this.dataSource.manager, query);
  }

  /**
   * One published version by id, or a 404 when the id matches no row. The repository reports
   * absence; turning that into the client-facing error is this module's job, so every caller
   * refuses an unknown id the same way.
   */
  async getById(manager: EntityManager, id: string): Promise<AgreementVersionEntity> {
    const agreement = await this.agreementsRepository.findById(manager, id);

    if (agreement === undefined) {
      throw new AgreementNotFoundException();
    }

    return agreement;
  }

  /**
   * The highest published version of each family named, keyed by family. A key with nothing
   * published is absent from the map rather than an error here - what that absence means depends
   * on who asked, and at onboarding start it means the start cannot proceed.
   *
   * Exposed on the service rather than left to the repository so the onboardings module has one
   * door into this feature.
   */
  async findLatestForKeys(
    manager: EntityManager,
    keys: readonly string[],
  ): Promise<Map<string, AgreementVersionEntity>> {
    return this.agreementsRepository.findLatestForKeys(manager, keys);
  }

  /**
   * Links one agreement to one onboarding as `pending`, recording `agreement.linked` when the
   * link did not already exist, and reports whether it did.
   *
   * Writes on the caller's manager: the link and its audit row belong to whichever transaction
   * created the onboarding or served the request. Notifying is deliberately left to the caller,
   * which enqueues after its own commit for the same reason `publish` does.
   */
  async linkPending(
    manager: EntityManager,
    agreement: AgreementVersionEntity,
    onboardingId: string,
    origin: AgreementLinkOrigin,
  ): Promise<boolean> {
    const [result] = await this.onboardingAgreementsRepository.createPendingLinks(
      manager,
      agreement,
      [onboardingId],
    );

    if (!result.created) {
      return false;
    }

    await this.logLink(manager, agreement, onboardingId, origin);

    return true;
  }

  /**
   * Links the new version to every onboarding behind it and returns what the publish now owes a
   * notification for. Only links this call actually created are returned: the insert skips a pair
   * already linked, and notifying on one of those would tell a client twice about an agreement it
   * was already told it owes.
   */
  private async linkOnboardingsBehind(
    manager: EntityManager,
    agreement: AgreementVersionEntity,
  ): Promise<PendingAgreementNotification[]> {
    const behind = await this.onboardingAgreementsRepository.findOnboardingsBelowVersion(
      manager,
      agreement,
    );

    if (behind.length === 0) {
      return [];
    }

    const links = await this.onboardingAgreementsRepository.createPendingLinks(
      manager,
      agreement,
      behind.map((onboarding) => onboarding.onboardingId),
    );
    const createdIds = new Set(
      links.filter((link) => link.created).map((link) => link.onboardingId),
    );

    if (createdIds.size === 0) {
      return [];
    }

    const onboardings = await this.onboardingAgreementsRepository.findOnboardings(manager, [
      ...createdIds,
    ]);
    const onboardingsById = new Map(onboardings.map((onboarding) => [onboarding.id, onboarding]));
    const notifications: PendingAgreementNotification[] = [];

    for (const behindOnboarding of behind) {
      const onboarding = onboardingsById.get(behindOnboarding.onboardingId);

      if (onboarding === undefined) {
        continue;
      }

      await this.logLink(manager, agreement, onboarding.id, 'version_published');
      notifications.push({
        onboarding,
        previousAcceptedVersion: behindOnboarding.acceptedVersion,
      });
    }

    return notifications;
  }

  /**
   * Enqueues one notification per link the publish created, after its transaction has committed.
   *
   * Each event goes to the notify webhook of the onboarding's *own* workflow revision - a publish
   * has no workflow of its own - so the revisions are resolved once each rather than once per
   * onboarding. A revision that can no longer be loaded costs that onboarding its notification
   * and nothing else: the link is already committed and the version is published either way.
   */
  private async notifyPending(
    agreement: AgreementVersionEntity,
    notifications: readonly PendingAgreementNotification[],
  ): Promise<void> {
    const workflows = new Map<string, Workflow | undefined>();

    for (const notification of notifications) {
      const { onboarding } = notification;
      const revision = onboarding.workflowVersionId;

      if (!workflows.has(revision)) {
        workflows.set(revision, await this.findWorkflow(onboarding));
      }

      const workflow = workflows.get(revision);

      if (workflow === undefined) {
        continue;
      }

      await this.webhookService.notifyAgreementPending(
        onboarding,
        workflow,
        agreement,
        notification.previousAcceptedVersion,
      );
    }
  }

  private async findWorkflow(onboarding: AgreementFanOutOnboarding): Promise<Workflow | undefined> {
    return this.workflowRegistryService.getByVersionId(onboarding.workflowVersionId).catch(() => {
      this.logger.warn(
        `AGREEMENT_NOTIFICATION_SUPPRESSED onboardingId=${onboarding.id} reason=workflow_unavailable workflowId=${onboarding.getWorkflowKey()} workflowVersion=${onboarding.getWorkflowVersionNumber()}`,
      );

      return undefined;
    });
  }

  private async logLink(
    manager: EntityManager,
    agreement: AgreementVersionEntity,
    onboardingId: string,
    origin: AgreementLinkOrigin,
  ): Promise<void> {
    await this.auditService.logAgreement(manager, {
      action: 'agreement.linked',
      resourceId: onboardingId,
      metadata: {
        agreementId: agreement.agreementVersionId,
        key: agreement.agreement.key,
        version: agreement.version,
        origin,
      },
    });
  }
}
