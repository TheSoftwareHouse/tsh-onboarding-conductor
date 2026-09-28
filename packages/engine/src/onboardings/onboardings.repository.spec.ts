import { EntityManager, Repository } from 'typeorm';
import { OnboardingAgreementStatusView } from './entity/onboarding-agreement-status.view';
import { OnboardingEntity } from './entity/onboarding.entity';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { OnboardingsRepository } from './onboardings.repository';

describe('OnboardingsRepository', () => {
  /** Every chaining method returns the builder itself, so a call chain reads back off one mock. */
  const createQueryBuilderMock = () => {
    const chainable = {
      innerJoin: jest.fn(),
      addSelect: jest.fn(),
      leftJoinAndMapOne: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      clone: jest.fn(),
    };
    const queryBuilder = {
      ...chainable,
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    };

    for (const method of Object.keys(chainable)) {
      (queryBuilder[method as keyof typeof chainable] as jest.Mock).mockReturnValue(queryBuilder);
    }

    return queryBuilder;
  };

  const createHarness = () => {
    const queryBuilder = createQueryBuilderMock();
    const repositoryMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<OnboardingEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repositoryMock),
    } as unknown as EntityManager;

    return { sut: new OnboardingsRepository(), manager, repositoryMock, queryBuilder };
  };

  const createQuery = (overrides: Partial<ListAdminOnboardingsQueryDto> = {}) =>
    Object.assign(new ListAdminOnboardingsQueryDto(), overrides);

  const findStatusFilter = (queryBuilder: ReturnType<typeof createQueryBuilderMock>) =>
    queryBuilder.andWhere.mock.calls.find(([condition]) =>
      String(condition).includes('agreementStatusView'),
    );

  describe('the derived agreement status', () => {
    it.each([['findById'], ['findForAdmin']])(
      'joins the status view into %s so a reader gets it without a second query',
      async (method) => {
        const harness = createHarness();

        if (method === 'findById') {
          await harness.sut.findById(harness.manager, 'onboarding-1');
        } else {
          await harness.sut.findForAdmin(harness.manager, createQuery());
        }

        expect(harness.queryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
          'onboarding.agreementStatusView',
          OnboardingAgreementStatusView,
          'agreementStatusView',
          'agreementStatusView.onboardingId = onboarding.id',
        );
        expect(harness.queryBuilder.innerJoin).toHaveBeenCalledWith(
          'onboarding.workflowVersion',
          'workflowVersion',
        );
        expect(harness.queryBuilder.innerJoin).toHaveBeenCalledWith(
          'workflowVersion.workflow',
          'workflow',
        );
        // Named columns, never the relations whole: `workflow_versions.definition` is the entire
        // authored workflow document, and selecting it would carry one copy per listed row.
        expect(harness.queryBuilder.addSelect).toHaveBeenCalledWith([
          'workflowVersion.workflowVersionId',
          'workflowVersion.version',
          'workflow.workflowId',
          'workflow.key',
        ]);
      },
    );

    it('filters on a bound parameter, never on the value spliced into the condition', async () => {
      const harness = createHarness();

      await harness.sut.findForAdmin(harness.manager, createQuery({ agreementStatus: 'outdated' }));

      const statusFilter = findStatusFilter(harness.queryBuilder);

      expect(statusFilter).toBeDefined();
      expect(statusFilter![0]).not.toContain('outdated');
      expect(statusFilter![1]).toEqual({
        agreementStatus: 'outdated',
        notAcceptedAgreementStatus: 'not_accepted',
      });
    });

    it('coalesces the missing view row so an onboarding with no links still matches', async () => {
      const harness = createHarness();

      await harness.sut.findForAdmin(
        harness.manager,
        createQuery({ agreementStatus: 'not_accepted' }),
      );

      expect(findStatusFilter(harness.queryBuilder)![0]).toContain('COALESCE');
    });

    it('leaves the filter off entirely when the query names no status', async () => {
      const harness = createHarness();

      await harness.sut.findForAdmin(harness.manager, createQuery({ status: 'approved' }));

      expect(findStatusFilter(harness.queryBuilder)).toBeUndefined();
    });
  });

  describe('the workflow filters', () => {
    const findAndWhere = (
      queryBuilder: ReturnType<typeof createQueryBuilderMock>,
      needle: string,
    ) => queryBuilder.andWhere.mock.calls.find(([condition]) => String(condition).includes(needle));

    it('filters on the joined workflow name for the workflowId query parameter', async () => {
      const harness = createHarness();

      await harness.sut.findForAdmin(
        harness.manager,
        createQuery({ workflowId: 'passport-check' }),
      );

      const filter = findAndWhere(harness.queryBuilder, 'workflow.key');

      expect(filter).toBeDefined();
      expect(filter![1]).toEqual({ workflowId: 'passport-check' });
    });

    it('filters on the joined workflow version for the workflowVersion query parameter', async () => {
      const harness = createHarness();

      await harness.sut.findForAdmin(harness.manager, createQuery({ workflowVersion: 7 }));

      const filter = findAndWhere(harness.queryBuilder, 'workflowVersion.version');

      expect(filter).toBeDefined();
      expect(filter![1]).toEqual({ workflowVersion: 7 });
    });
  });

  describe('lockAndRefreshPreflight', () => {
    it('copies scores from the locked row onto the in-memory entity', async () => {
      const harness = createHarness();
      const onboarding = Object.assign(new OnboardingEntity(), {
        id: 'onboarding-1',
        workflowVersionId: '01912345-6789-7abc-8def-00000000f001',
        status: 'awaiting_user',
        currentStep: 'collect_profile',
        context: {},
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: null,
        rejectionReason: null,
        scores: {},
      });
      const persistedOnboarding = Object.assign(new OnboardingEntity(), {
        id: 'onboarding-1',
        workflowVersionId: '01912345-6789-7abc-8def-00000000f001',
        status: 'awaiting_user',
        currentStep: 'collect_profile',
        context: {},
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:05:00.000Z'),
        completedAt: null,
        rejectionReason: null,
        scores: { risk: 40 },
      });
      (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(persistedOnboarding);

      await harness.sut.lockAndRefreshPreflight(harness.manager, onboarding);

      expect(onboarding.scores).toEqual({ risk: 40 });
    });
  });
});
