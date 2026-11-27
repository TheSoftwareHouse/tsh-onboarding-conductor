import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, QueryRunner } from 'typeorm';
import { OrganizationOwnership0004 } from '../src/database/migrations/0004_organization_ownership';
import {
  BASE_WORKFLOW_AGREEMENT_KEY,
  BASE_WORKFLOW_AGREEMENT_TYPE,
  ensureAgreementPublished,
} from './agreements.support';
import { startE2eServer } from './e2e-server';

const OWNED_TABLES = ['agreements', 'workflows', 'onboardings'] as const;

/**
 * Story 1.1: the engine's data belongs to an organization and a default one exists. The upgrade
 * paths run migration 0004's `down` and `up` inside one transaction that is always rolled back,
 * so the shared Compose volume is the same afterwards.
 */
describe('Default organization (e2e)', () => {
  let app: NestExpressApplication | null = null;
  let organizationCountBeforeSuite = 0;

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('The application is not booted');
    }
    return app;
  };

  const boot = async (): Promise<NestExpressApplication> => {
    // This suite sends no admin session; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const bootedApp = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    bootedApp.useBodyParser('json', { strict: false });
    bootedApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await startE2eServer(bootedApp);
    return bootedApp;
  };

  const dataSource = (): DataSource => getApp().get(DataSource);

  const countOrganizations = async (): Promise<number> => {
    const rows = await dataSource().query('SELECT count(*)::int AS count FROM auth."organization"');
    return rows[0].count;
  };

  /** Runs `scenario` in a transaction that is rolled back whether it passes or throws. */
  const inRolledBackTransaction = async (
    scenario: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> => {
    const queryRunner = dataSource().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await scenario(queryRunner);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  };

  const countRows = async (queryRunner: QueryRunner, table: string): Promise<number> => {
    const rows = await queryRunner.query(`SELECT count(*)::int AS count FROM ${table}`);
    return rows[0].count;
  };

  beforeAll(async () => {
    app = await boot();
    await ensureAgreementPublished(
      getApp(),
      BASE_WORKFLOW_AGREEMENT_KEY,
      BASE_WORKFLOW_AGREEMENT_TYPE,
    );
    organizationCountBeforeSuite = await countOrganizations();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('seeds exactly one default organization when none exists', async () => {
    await inRolledBackTransaction(async (queryRunner) => {
      const migration = new OrganizationOwnership0004();
      await migration.down(queryRunner);
      await queryRunner.query('DELETE FROM auth."organization"');

      await migration.up(queryRunner);

      const organizations = await queryRunner.query(
        'SELECT name, slug, "parentId" FROM auth."organization"',
      );
      expect(organizations).toEqual([
        { name: 'Default organisation', slug: 'default', parentId: null },
      ]);
    });
  });

  it('adopts the oldest organization for every existing row without losing any', async () => {
    await inRolledBackTransaction(async (queryRunner) => {
      const migration = new OrganizationOwnership0004();
      await migration.down(queryRunner);
      await queryRunner.query('DELETE FROM auth."organization"');

      // Better-auth ids are not UUIDs, and the older one is inserted second on purpose.
      await queryRunner.query(
        `INSERT INTO auth."organization" ("id", "name", "slug", "createdAt") VALUES
           ('org-newer', 'Newer', 'newer', '2026-02-01T00:00:00Z'),
           ('org-older', 'Older', 'older', '2026-01-01T00:00:00Z')`,
      );

      const workflowId = randomUUID();
      const workflowVersionId = randomUUID();
      await queryRunner.query(
        `INSERT INTO workflows (workflow_id, key, scope) VALUES ($1, $2, 'users')`,
        [workflowId, `legacy-${workflowId}`],
      );
      await queryRunner.query(
        `INSERT INTO workflow_versions (workflow_version_id, workflow_id, version, definition)
         VALUES ($1, $2, 1, '{}')`,
        [workflowVersionId, workflowId],
      );
      await queryRunner.query(`INSERT INTO agreements (id, key, type) VALUES ($1, $2, 'terms')`, [
        randomUUID(),
        `legacy-${randomUUID()}`,
      ]);
      await queryRunner.query(
        `INSERT INTO onboardings (id, workflow_version_id, status, current_step)
         VALUES ($1, $2, 'awaiting_user', 'collect')`,
        [randomUUID(), workflowVersionId],
      );

      const before: Record<string, number> = {};
      for (const table of OWNED_TABLES) {
        before[table] = await countRows(queryRunner, table);
      }

      await migration.up(queryRunner);

      expect(await countRows(queryRunner, 'auth."organization"')).toBe(2);
      for (const table of OWNED_TABLES) {
        expect(await countRows(queryRunner, table)).toBe(before[table]);
        const owners = await queryRunner.query(`SELECT DISTINCT organization_id FROM ${table}`);
        expect(owners).toEqual([{ organization_id: 'org-older' }]);
      }
    });
  });

  it('creates no second organization when the application restarts', async () => {
    await getApp().close();
    app = await boot();

    expect(await countOrganizations()).toBe(organizationCountBeforeSuite);
    expect(organizationCountBeforeSuite).toBeGreaterThanOrEqual(1);
  });

  it('gives an onboarding started over HTTP the default organization', async () => {
    const response = await request(getApp().getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: 'base' })
      .expect(201);

    const [row] = await dataSource().query(
      `SELECT organization_id FROM onboardings WHERE id = $1`,
      [response.body.onboardingId],
    );
    const [oldest] = await dataSource().query(
      `SELECT id FROM auth."organization" ORDER BY "createdAt", id LIMIT 1`,
    );
    expect(row.organization_id).toBe(oldest.id);
  });

  it('gives the workflow loaded at boot and the published agreement the default organization', async () => {
    const [oldest] = await dataSource().query(
      `SELECT id FROM auth."organization" ORDER BY "createdAt", id LIMIT 1`,
    );
    const workflows = await dataSource().query(
      `SELECT organization_id FROM workflows WHERE key = $1`,
      ['base'],
    );
    const agreements = await dataSource().query(
      `SELECT organization_id FROM agreements WHERE key = $1`,
      [BASE_WORKFLOW_AGREEMENT_KEY],
    );

    expect(workflows.length).toBeGreaterThan(0);
    expect(agreements.length).toBeGreaterThan(0);
    for (const row of [...workflows, ...agreements]) {
      expect(row.organization_id).toBe(oldest.id);
    }
  });

  it('leaves the organization table as it found it', async () => {
    expect(await countOrganizations()).toBe(organizationCountBeforeSuite);
  });
});
