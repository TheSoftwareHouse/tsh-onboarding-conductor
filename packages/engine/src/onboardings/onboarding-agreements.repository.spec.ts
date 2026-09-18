import { EntityManager } from 'typeorm';
import { AgreementEntity } from '../agreements/entity/agreement.entity';
import { AgreementVersionEntity } from '../agreements/entity/agreement-version.entity';
import {
  OnboardingAgreementsRepository,
  type AgreementLinkResult,
  type OnboardingAcceptedVersion,
} from './onboarding-agreements.repository';

describe('OnboardingAgreementsRepository', () => {
  const createAgreementVersion = (
    overrides: Partial<AgreementVersionEntity> = {},
  ): AgreementVersionEntity =>
    Object.assign(new AgreementVersionEntity(), {
      agreementVersionId: 'agreement-version-2',
      agreementId: 'agreement-1',
      version: 2,
      publishedAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      agreement: Object.assign(new AgreementEntity(), {
        id: 'agreement-1',
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
      }),
      ...overrides,
    });

  const createHarness = () => {
    const find = jest.fn().mockResolvedValue([]);
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockReturnValue({ find }),
    } as unknown as EntityManager;

    return { sut: new OnboardingAgreementsRepository(), manager, find };
  };

  const readQueryCall = (manager: EntityManager, index: number): [string, unknown[]] =>
    (manager.query as jest.Mock).mock.calls[index] as [string, unknown[]];

  describe('createPendingLinks', () => {
    it('links every onboarding as pending in one statement', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        { onboardingId: 'onboarding-1', created: true },
        { onboardingId: 'onboarding-2', created: true },
      ] satisfies AgreementLinkResult[]);

      const result = await harness.sut.createPendingLinks(
        harness.manager,
        createAgreementVersion(),
        ['onboarding-1', 'onboarding-2'],
      );

      expect(harness.manager.query).toHaveBeenCalledTimes(1);
      const [sql, parameters] = readQueryCall(harness.manager, 0);
      expect(sql).toContain('INSERT INTO onboarding_agreements');
      expect(sql).toContain('agreement_version_id');
      expect(parameters).toEqual([
        ['onboarding-1', 'onboarding-2'],
        'agreement-version-2',
        'pending',
      ]);
      expect(result).toEqual([
        { onboardingId: 'onboarding-1', created: true },
        { onboardingId: 'onboarding-2', created: true },
      ]);
    });

    it('reports an already-linked pair as not created instead of inserting a second row', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        { onboardingId: 'onboarding-1', created: false },
      ] satisfies AgreementLinkResult[]);

      const result = await harness.sut.createPendingLinks(
        harness.manager,
        createAgreementVersion(),
        ['onboarding-1'],
      );

      expect(result).toEqual([{ onboardingId: 'onboarding-1', created: false }]);
      expect(harness.manager.query).toHaveBeenCalledTimes(1);
      const [sql] = readQueryCall(harness.manager, 0);
      expect(sql).toContain('ON CONFLICT ON CONSTRAINT pk_onboarding_agreements DO NOTHING');
    });

    it('sends the onboarding ids in chunks rather than one statement per onboarding', async () => {
      const harness = createHarness();
      const onboardingIds = Array.from({ length: 1200 }, (_, index) => `onboarding-${index}`);
      (harness.manager.query as jest.Mock).mockImplementation(
        async (_sql: string, parameters: unknown[]) =>
          (parameters[0] as string[]).map((onboardingId) => ({ onboardingId, created: true })),
      );

      const result = await harness.sut.createPendingLinks(
        harness.manager,
        createAgreementVersion(),
        onboardingIds,
      );

      expect(harness.manager.query).toHaveBeenCalledTimes(3);
      expect(
        (harness.manager.query as jest.Mock).mock.calls.map(
          (call) => (call[1] as [string[]])[0].length,
        ),
      ).toEqual([500, 500, 200]);
      expect(result).toHaveLength(1200);
    });

    it('issues no statement when there is nothing to link', async () => {
      const harness = createHarness();

      const result = await harness.sut.createPendingLinks(
        harness.manager,
        createAgreementVersion(),
        [],
      );

      expect(result).toEqual([]);
      expect(harness.manager.query).not.toHaveBeenCalled();
    });
  });

  describe('acceptLink', () => {
    it('writes the accepted status and its timestamp in the same statement', async () => {
      const harness = createHarness();
      const acceptedAt = new Date('2026-03-01T10:00:00.000Z');
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          onboardingId: 'onboarding-1',
          agreementVersionId: 'agreement-version-2',
          status: 'accepted',
          acceptedAt,
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ]);

      const result = await harness.sut.acceptLink(
        harness.manager,
        createAgreementVersion(),
        'onboarding-1',
        acceptedAt,
      );

      expect(harness.manager.query).toHaveBeenCalledTimes(1);
      const [sql, parameters] = readQueryCall(harness.manager, 0);
      expect(sql).toContain('accepted_at');
      expect(parameters).toEqual(['onboarding-1', 'agreement-version-2', 'accepted', acceptedAt]);
      expect(result.status).toBe('accepted');
      expect(result.acceptedAt).toEqual(acceptedAt);
    });

    it('upserts the link so a never-linked onboarding can still accept', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          onboardingId: 'onboarding-1',
          agreementVersionId: 'agreement-version-2',
          status: 'accepted',
          acceptedAt: new Date('2026-03-01T10:00:00.000Z'),
          createdAt: new Date('2026-03-01T10:00:00.000Z'),
        },
      ]);

      await harness.sut.acceptLink(
        harness.manager,
        createAgreementVersion(),
        'onboarding-1',
        new Date('2026-03-01T10:00:00.000Z'),
      );

      const [sql] = readQueryCall(harness.manager, 0);
      expect(sql).toContain('ON CONFLICT ON CONSTRAINT pk_onboarding_agreements DO UPDATE');
      expect(sql).toContain('COALESCE(onboarding_agreements.accepted_at, EXCLUDED.accepted_at)');
    });
  });

  describe('findLink', () => {
    it('reports the link the pair already holds', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          onboardingId: 'onboarding-1',
          agreementVersionId: 'agreement-version-2',
          status: 'pending',
          acceptedAt: null,
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ]);

      const result = await harness.sut.findLink(
        harness.manager,
        createAgreementVersion(),
        'onboarding-1',
      );

      const [sql, parameters] = readQueryCall(harness.manager, 0);
      expect(sql).toContain('FROM onboarding_agreements');
      expect(parameters).toEqual(['onboarding-1', 'agreement-version-2']);
      expect(result).toEqual(
        expect.objectContaining({ agreementVersionId: 'agreement-version-2', status: 'pending' }),
      );
    });

    it('reports a pair that was never linked as undefined rather than an empty row', async () => {
      const harness = createHarness();

      await expect(
        harness.sut.findLink(harness.manager, createAgreementVersion(), 'onboarding-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findOnboardings', () => {
    it('reads the onboardings a fan-out notifies in one statement', async () => {
      const harness = createHarness();
      harness.find.mockResolvedValue([{ id: 'onboarding-1' }]);

      const result = await harness.sut.findOnboardings(harness.manager, ['onboarding-1']);

      expect(harness.find).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ id: 'onboarding-1' }]);
    });

    it('loads the workflow relation two levels deep, narrow of the jsonb columns', async () => {
      const harness = createHarness();

      await harness.sut.findOnboardings(harness.manager, ['onboarding-1']);

      expect(harness.find).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: { workflowVersion: { workflow: true } },
          select: expect.objectContaining({
            id: true,
            status: true,
            workflowVersionId: true,
            workflowVersion: { version: true, workflow: { name: true } },
          }),
        }),
      );
    });

    it('chunks the ids so a large fan-out cannot exceed the bind-parameter limit', async () => {
      const harness = createHarness();
      const onboardingIds = Array.from({ length: 1200 }, (_, index) => `onboarding-${index}`);
      harness.find.mockImplementation(async (options: { where: { id: { value: string[] } } }) =>
        options.where.id.value.map((id) => ({ id })),
      );

      const result = await harness.sut.findOnboardings(harness.manager, onboardingIds);

      expect(
        harness.find.mock.calls.map(
          (call) => (call[0] as { where: { id: { value: string[] } } }).where.id.value.length,
        ),
      ).toEqual([500, 500, 200]);
      expect(result).toHaveLength(1200);
    });

    it('issues no statement when the fan-out created no link', async () => {
      const harness = createHarness();

      await expect(harness.sut.findOnboardings(harness.manager, [])).resolves.toEqual([]);
      expect(harness.find).not.toHaveBeenCalled();
    });
  });

  describe('findOnboardingsBelowVersion', () => {
    it('resolves many onboardings and their accepted versions in one query', async () => {
      const harness = createHarness();
      const rows: OnboardingAcceptedVersion[] = Array.from({ length: 250 }, (_, index) => ({
        onboardingId: `onboarding-${index}`,
        acceptedVersion: 1,
      }));
      (harness.manager.query as jest.Mock).mockResolvedValue(rows);

      const result = await harness.sut.findOnboardingsBelowVersion(
        harness.manager,
        createAgreementVersion(),
      );

      expect(harness.manager.query).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(250);
    });

    it('looks only at accepted links of the version own family below its version', async () => {
      const harness = createHarness();

      await harness.sut.findOnboardingsBelowVersion(
        harness.manager,
        createAgreementVersion({ agreementId: 'agreement-privacy', version: 4 }),
      );

      const [sql, parameters] = readQueryCall(harness.manager, 0);
      expect(sql).toContain('HAVING MAX(published.version) < $3');
      expect(sql).toContain('published.agreement_id = $1');
      expect(parameters).toEqual(['agreement-privacy', 'accepted', 4]);
    });
  });

  describe('findSummaries', () => {
    it('pairs the accepted version of each held family with its latest published version', async () => {
      const harness = createHarness();
      (harness.manager.query as jest.Mock).mockResolvedValue([
        {
          key: 'eu-b2c-terms',
          type: 'terms_and_conditions',
          latestAgreementId: 'agreement-version-2',
          latestVersion: 2,
          acceptedVersion: 1,
          acceptedAt: new Date('2026-02-01T00:00:00.000Z'),
        },
        {
          key: 'eu-b2c-privacy',
          type: 'privacy_notice',
          latestAgreementId: 'privacy-version-1',
          latestVersion: 1,
          acceptedVersion: null,
          acceptedAt: null,
        },
      ]);

      const result = await harness.sut.findSummaries(harness.manager, 'onboarding-1');

      expect(harness.manager.query).toHaveBeenCalledTimes(1);
      const [, parameters] = readQueryCall(harness.manager, 0);
      expect(parameters).toEqual(['onboarding-1', 'accepted']);
      expect(result[0]).toEqual({
        key: 'eu-b2c-terms',
        type: 'terms_and_conditions',
        latestAgreementId: 'agreement-version-2',
        latestVersion: 2,
        acceptedVersion: 1,
        acceptedAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      expect(result[1].acceptedVersion).toBeNull();
    });
  });
});
