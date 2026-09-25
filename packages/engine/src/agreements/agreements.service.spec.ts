import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import {
  OnboardingAgreementsRepository,
  type AgreementFanOutOnboarding,
} from '../onboardings/onboarding-agreements.repository';
import { WebhookService } from '../webhook/webhook.service';
import { Workflow } from '../workflows/domain/workflow';
import { WorkflowEntity } from '../workflows/entity/workflow.entity';
import { WorkflowVersionEntity } from '../workflows/entity/workflow-version.entity';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { AgreementsRepository } from './agreements.repository';
import { AgreementsService } from './agreements.service';
import { ListAgreementsQueryDto } from './dto/list-agreements.query.dto';
import { AgreementEntity } from './entity/agreement.entity';
import { AgreementVersionEntity } from './entity/agreement-version.entity';
import { AgreementNotFoundException } from './errors/agreement-not-found.exception';
import { AgreementTypeMismatchException } from './errors/agreement-type-mismatch.exception';
import { AgreementVersionConflictException } from './errors/agreement-version-conflict.exception';

const KEY = 'eu-b2c-terms';
const OPERATOR = 'operator-oid';
const ONBOARDING_A = '01912345-6789-7abc-8def-0123456789a1';
const ONBOARDING_B = '01912345-6789-7abc-8def-0123456789a2';
const WORKFLOW_VERSION_ID = '01912345-6789-7abc-8def-000000000wv1';

const createAgreement = (
  version: number,
  overrides: Partial<AgreementVersionEntity> = {},
): AgreementVersionEntity =>
  Object.assign(new AgreementVersionEntity(), {
    agreementVersionId: `01912345-6789-7abc-8def-00000000000${version}`,
    agreementId: '01912345-6789-7abc-8def-0000000000a1',
    version,
    publishedAt: new Date('2026-02-01T00:00:00.000Z'),
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    agreement: Object.assign(new AgreementEntity(), {
      id: '01912345-6789-7abc-8def-0000000000a1',
      key: KEY,
      type: 'terms_and_conditions',
    }),
    ...overrides,
  });

const createOnboarding = (
  id: string,
  workflowVersionId: string = WORKFLOW_VERSION_ID,
): AgreementFanOutOnboarding =>
  Object.assign(new OnboardingEntity(), {
    id,
    workflowVersionId,
    status: 'awaiting_user',
    workflowVersion: Object.assign(new WorkflowVersionEntity(), {
      version: 1,
      workflow: Object.assign(new WorkflowEntity(), { name: 'eu-b2c-individual-kyc-eea' }),
    }),
  });

/** A unique violation as the Postgres driver reports it, wrapped the way TypeORM wraps it. */
const createUniqueViolation = (constraint: string) =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    driverError: { code: '23505', constraint },
  });

function createSut() {
  /** Records the order commit and enqueue happened in, which is the whole point of the split. */
  const order: string[] = [];
  const manager = {} as EntityManager;
  const dataSource = {
    manager,
    transaction: jest.fn(async (callback: (tx: EntityManager) => Promise<unknown>) => {
      const result = await callback(manager);
      order.push('commit');
      return result;
    }),
  } as unknown as DataSource;

  const agreementsRepository = {
    createNextVersion: jest.fn(),
    findLatestForKeys: jest.fn(),
    findById: jest.fn(),
    findForAdmin: jest.fn(),
  } as unknown as jest.Mocked<AgreementsRepository>;

  const onboardingAgreementsRepository = {
    createPendingLinks: jest.fn().mockResolvedValue([]),
    acceptLink: jest.fn(),
    findOnboardingsBelowVersion: jest.fn().mockResolvedValue([]),
    findOnboardings: jest.fn().mockResolvedValue([]),
    findSummaries: jest.fn(),
  } as unknown as jest.Mocked<OnboardingAgreementsRepository>;

  const workflow = { id: 'eu-b2c-individual-kyc-eea' } as unknown as Workflow;
  const workflowRegistryService = {
    getByVersionId: jest.fn().mockResolvedValue(workflow),
  } as unknown as jest.Mocked<WorkflowRegistryService>;

  const webhookService = {
    notifyAgreementPending: jest.fn().mockImplementation(async () => {
      order.push('notify');
    }),
  } as unknown as jest.Mocked<WebhookService>;

  const auditService = {
    logAgreement: jest.fn(),
  } as unknown as jest.Mocked<AuditService>;

  return {
    order,
    manager,
    dataSource,
    agreementsRepository,
    onboardingAgreementsRepository,
    workflow,
    workflowRegistryService,
    webhookService,
    auditService,
    sut: new AgreementsService(
      dataSource,
      agreementsRepository,
      onboardingAgreementsRepository,
      workflowRegistryService,
      webhookService,
      auditService,
    ),
  };
}

describe('AgreementsService', () => {
  describe('publish', () => {
    it('links every onboarding behind the new version and notifies each of them once', async () => {
      const context = createSut();
      const published = createAgreement(2);
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);
      context.onboardingAgreementsRepository.findOnboardingsBelowVersion.mockResolvedValue([
        { onboardingId: ONBOARDING_A, acceptedVersion: 1 },
        { onboardingId: ONBOARDING_B, acceptedVersion: 1 },
      ]);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
        { onboardingId: ONBOARDING_B, created: true },
      ]);
      context.onboardingAgreementsRepository.findOnboardings.mockResolvedValue([
        createOnboarding(ONBOARDING_A),
        createOnboarding(ONBOARDING_B),
      ]);

      const result = await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(result).toEqual({ agreement: published, linkedOnboardings: 2 });
      expect(context.onboardingAgreementsRepository.createPendingLinks).toHaveBeenCalledWith(
        context.manager,
        published,
        [ONBOARDING_A, ONBOARDING_B],
      );
      expect(context.webhookService.notifyAgreementPending).toHaveBeenCalledTimes(2);
      expect(context.webhookService.notifyAgreementPending).toHaveBeenNthCalledWith(
        1,
        createOnboarding(ONBOARDING_A),
        context.workflow,
        published,
        1,
      );
      expect(context.webhookService.notifyAgreementPending).toHaveBeenNthCalledWith(
        2,
        createOnboarding(ONBOARDING_B),
        context.workflow,
        published,
        1,
      );
    });

    it('neither links nor notifies an onboarding that already accepted the new version', async () => {
      const context = createSut();
      const published = createAgreement(2);
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);
      // Only A is behind: B accepted v2 already, so the fan-out's own query leaves it out.
      context.onboardingAgreementsRepository.findOnboardingsBelowVersion.mockResolvedValue([
        { onboardingId: ONBOARDING_A, acceptedVersion: 1 },
      ]);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
      ]);
      context.onboardingAgreementsRepository.findOnboardings.mockResolvedValue([
        createOnboarding(ONBOARDING_A),
      ]);

      const result = await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(result.linkedOnboardings).toBe(1);
      expect(
        context.onboardingAgreementsRepository.findOnboardingsBelowVersion,
      ).toHaveBeenCalledWith(context.manager, published);
      expect(context.onboardingAgreementsRepository.createPendingLinks).toHaveBeenCalledWith(
        context.manager,
        published,
        [ONBOARDING_A],
      );
      expect(context.webhookService.notifyAgreementPending).toHaveBeenCalledTimes(1);
      expect(context.webhookService.notifyAgreementPending).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: ONBOARDING_B }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('links nothing at all when no onboarding is behind the new version', async () => {
      const context = createSut();
      context.agreementsRepository.createNextVersion.mockResolvedValue(createAgreement(2));

      const result = await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(result.linkedOnboardings).toBe(0);
      expect(context.onboardingAgreementsRepository.createPendingLinks).not.toHaveBeenCalled();
      expect(context.webhookService.notifyAgreementPending).not.toHaveBeenCalled();
    });

    it('does not notify a link the insert found already there, so a retry cannot notify twice', async () => {
      const context = createSut();
      const published = createAgreement(2);
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);
      context.onboardingAgreementsRepository.findOnboardingsBelowVersion.mockResolvedValue([
        { onboardingId: ONBOARDING_A, acceptedVersion: 1 },
        { onboardingId: ONBOARDING_B, acceptedVersion: 1 },
      ]);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
        { onboardingId: ONBOARDING_B, created: false },
      ]);
      context.onboardingAgreementsRepository.findOnboardings.mockResolvedValue([
        createOnboarding(ONBOARDING_A),
      ]);

      const result = await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(context.onboardingAgreementsRepository.findOnboardings).toHaveBeenCalledWith(
        context.manager,
        [ONBOARDING_A],
      );
      expect(result.linkedOnboardings).toBe(1);
      expect(context.webhookService.notifyAgreementPending).toHaveBeenCalledTimes(1);
    });

    it('enqueues every notification only after the transaction has committed', async () => {
      const context = createSut();
      const published = createAgreement(2);
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);
      context.onboardingAgreementsRepository.findOnboardingsBelowVersion.mockResolvedValue([
        { onboardingId: ONBOARDING_A, acceptedVersion: 1 },
        { onboardingId: ONBOARDING_B, acceptedVersion: 1 },
      ]);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
        { onboardingId: ONBOARDING_B, created: true },
      ]);
      context.onboardingAgreementsRepository.findOnboardings.mockResolvedValue([
        createOnboarding(ONBOARDING_A),
        createOnboarding(ONBOARDING_B),
      ]);

      await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(context.order).toEqual(['commit', 'notify', 'notify']);
    });

    it('enqueues nothing when the transaction fails', async () => {
      const context = createSut();
      context.agreementsRepository.createNextVersion.mockRejectedValue(
        createUniqueViolation('uq_agreement_versions_agreement_version'),
      );

      await expect(context.sut.publish(KEY, 'terms_and_conditions', OPERATOR)).rejects.toThrow(
        AgreementVersionConflictException,
      );

      expect(context.webhookService.notifyAgreementPending).not.toHaveBeenCalled();
      expect(context.order).toEqual([]);
    });

    it('writes one linked row per created link and one published row for the version', async () => {
      const context = createSut();
      const published = createAgreement(2);
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);
      context.onboardingAgreementsRepository.findOnboardingsBelowVersion.mockResolvedValue([
        { onboardingId: ONBOARDING_A, acceptedVersion: 1 },
      ]);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
      ]);
      context.onboardingAgreementsRepository.findOnboardings.mockResolvedValue([
        createOnboarding(ONBOARDING_A),
      ]);

      await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(context.auditService.logAgreement).toHaveBeenCalledTimes(2);
      expect(context.auditService.logAgreement).toHaveBeenNthCalledWith(1, context.manager, {
        action: 'agreement.linked',
        resourceId: ONBOARDING_A,
        metadata: {
          agreementId: published.agreementVersionId,
          key: KEY,
          version: 2,
          origin: 'version_published',
        },
      });
      expect(context.auditService.logAgreement).toHaveBeenNthCalledWith(2, context.manager, {
        action: 'agreement.version_published',
        actorId: OPERATOR,
        resourceId: published.agreementVersionId,
        metadata: {
          key: KEY,
          type: 'terms_and_conditions',
          version: 2,
          linkedOnboardings: 1,
        },
      });
    });

    it('lets a type mismatch from the repository through untouched, writing no audit row', async () => {
      const context = createSut();
      context.agreementsRepository.createNextVersion.mockRejectedValue(
        new AgreementTypeMismatchException(KEY, 'terms_and_conditions', 'privacy_notice'),
      );

      await expect(context.sut.publish(KEY, 'privacy_notice', OPERATOR)).rejects.toThrow(
        AgreementTypeMismatchException,
      );

      expect(context.auditService.logAgreement).not.toHaveBeenCalled();
      expect(context.webhookService.notifyAgreementPending).not.toHaveBeenCalled();
    });

    it('publishes version one of a family nothing was ever published under', async () => {
      const context = createSut();
      const published = createAgreement(1);
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);

      const result = await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(result).toEqual({ agreement: published, linkedOnboardings: 0 });
      expect(context.agreementsRepository.createNextVersion).toHaveBeenCalledWith(
        context.manager,
        KEY,
        'terms_and_conditions',
      );
    });

    it('reports the losing half of two concurrent publishes as a version conflict', async () => {
      const context = createSut();
      context.agreementsRepository.createNextVersion.mockRejectedValue(
        createUniqueViolation('uq_agreement_versions_agreement_version'),
      );

      await expect(context.sut.publish(KEY, 'terms_and_conditions', OPERATOR)).rejects.toThrow(
        AgreementVersionConflictException,
      );
    });

    it('leaves a unique violation on another constraint alone', async () => {
      const context = createSut();
      const failure = createUniqueViolation('uq_something_else');
      context.agreementsRepository.createNextVersion.mockRejectedValue(failure);

      await expect(context.sut.publish(KEY, 'terms_and_conditions', OPERATOR)).rejects.toBe(
        failure,
      );
    });

    it('resolves each workflow revision once, however many onboardings share it', async () => {
      const context = createSut();
      const published = createAgreement(2);
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);
      context.onboardingAgreementsRepository.findOnboardingsBelowVersion.mockResolvedValue([
        { onboardingId: ONBOARDING_A, acceptedVersion: 1 },
        { onboardingId: ONBOARDING_B, acceptedVersion: 1 },
      ]);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
        { onboardingId: ONBOARDING_B, created: true },
      ]);
      context.onboardingAgreementsRepository.findOnboardings.mockResolvedValue([
        createOnboarding(ONBOARDING_A),
        createOnboarding(ONBOARDING_B),
      ]);

      await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(context.workflowRegistryService.getByVersionId).toHaveBeenCalledTimes(1);
      expect(context.workflowRegistryService.getByVersionId).toHaveBeenCalledWith(
        WORKFLOW_VERSION_ID,
      );
    });

    it('keeps the publish when one onboarding is on a revision that no longer loads', async () => {
      const context = createSut();
      const published = createAgreement(2);
      const unavailableVersionId = '01912345-6789-7abc-8def-000000000wv2';
      context.agreementsRepository.createNextVersion.mockResolvedValue(published);
      context.onboardingAgreementsRepository.findOnboardingsBelowVersion.mockResolvedValue([
        { onboardingId: ONBOARDING_A, acceptedVersion: 1 },
        { onboardingId: ONBOARDING_B, acceptedVersion: 1 },
      ]);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
        { onboardingId: ONBOARDING_B, created: true },
      ]);
      context.onboardingAgreementsRepository.findOnboardings.mockResolvedValue([
        createOnboarding(ONBOARDING_A, WORKFLOW_VERSION_ID),
        createOnboarding(ONBOARDING_B, unavailableVersionId),
      ]);
      context.workflowRegistryService.getByVersionId.mockImplementation(async (versionId) => {
        if (versionId === unavailableVersionId) {
          throw new Error('WORKFLOW_NOT_FOUND');
        }

        return context.workflow;
      });

      const result = await context.sut.publish(KEY, 'terms_and_conditions', OPERATOR);

      expect(result.linkedOnboardings).toBe(2);
      expect(context.webhookService.notifyAgreementPending).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it('reads the published versions through the caller-free default manager', async () => {
      const context = createSut();
      const page = {
        items: [createAgreement(1)],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      context.agreementsRepository.findForAdmin.mockResolvedValue(page);
      const query = Object.assign(new ListAgreementsQueryDto(), { key: KEY });

      await expect(context.sut.list(query)).resolves.toBe(page);
      expect(context.agreementsRepository.findForAdmin).toHaveBeenCalledWith(
        context.manager,
        query,
      );
    });
  });

  describe('getById', () => {
    it('returns the published version behind the id', async () => {
      const context = createSut();
      const agreement = createAgreement(3);
      context.agreementsRepository.findById.mockResolvedValue(agreement);

      await expect(
        context.sut.getById(context.manager, agreement.agreementVersionId),
      ).resolves.toBe(agreement);
    });

    it('refuses an id that matches no published version', async () => {
      const context = createSut();
      context.agreementsRepository.findById.mockResolvedValue(undefined);

      await expect(context.sut.getById(context.manager, 'missing')).rejects.toThrow(
        AgreementNotFoundException,
      );
    });
  });

  describe('findLatestForKeys', () => {
    it('resolves every family named in one read', async () => {
      const context = createSut();
      const latest = new Map([[KEY, createAgreement(2)]]);
      context.agreementsRepository.findLatestForKeys.mockResolvedValue(latest);

      await expect(context.sut.findLatestForKeys(context.manager, [KEY])).resolves.toBe(latest);
      expect(context.agreementsRepository.findLatestForKeys).toHaveBeenCalledWith(context.manager, [
        KEY,
      ]);
    });
  });

  describe('linkPending', () => {
    it('records the link it created against the onboarding, naming what caused it', async () => {
      const context = createSut();
      const agreement = createAgreement(1);
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
      ]);

      await expect(
        context.sut.linkPending(context.manager, agreement, ONBOARDING_A, 'onboarding_start'),
      ).resolves.toBe(true);

      expect(context.auditService.logAgreement).toHaveBeenCalledWith(context.manager, {
        action: 'agreement.linked',
        resourceId: ONBOARDING_A,
        metadata: {
          agreementId: agreement.agreementVersionId,
          key: KEY,
          version: 1,
          origin: 'onboarding_start',
        },
      });
    });

    it('records nothing for a pair that was already linked', async () => {
      const context = createSut();
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: false },
      ]);

      await expect(
        context.sut.linkPending(context.manager, createAgreement(1), ONBOARDING_A, 'manual'),
      ).resolves.toBe(false);

      expect(context.auditService.logAgreement).not.toHaveBeenCalled();
    });

    it('never notifies of its own accord, leaving that to the caller past its commit', async () => {
      const context = createSut();
      context.onboardingAgreementsRepository.createPendingLinks.mockResolvedValue([
        { onboardingId: ONBOARDING_A, created: true },
      ]);

      await context.sut.linkPending(context.manager, createAgreement(1), ONBOARDING_A, 'manual');

      expect(context.webhookService.notifyAgreementPending).not.toHaveBeenCalled();
    });
  });
});
