import type { DataSource, EntityManager } from 'typeorm';
import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import type { AuditService } from '../audit/audit.service';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { WorkflowRevisionNotFoundError } from '../workflows/errors/workflow-revision-not-found.error';
import type { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { CSV_BOM } from './domain/onboardings-csv';
import { OnboardingsExportService } from './onboardings-export.service';
import type { OnboardingsRepository } from './onboardings.repository';
import { createOnboarding } from './testing/onboardings-service.harness';

const BATCH_SIZE = 5000;
const ACTOR_ID = 'operator-1';
const manager = {} as EntityManager;
const dataSource = { manager } as unknown as DataSource;
const FIXED_HEADER =
  'Onboarding id,Workflow id,Workflow version,Status,Current step,Agreement status,Rejection reason,Created at,Updated at,Completed at';

const createDefinition = (fields: string[]): NormalizedWorkflowDefinition =>
  ({
    id: 'passport-check',
    version: 3,
    scores: {},
    steps: [
      {
        data: Object.fromEntries(fields.map((field) => [field, { type: 'text' }])),
      },
    ],
  }) as unknown as NormalizedWorkflowDefinition;

const createRows = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    createOnboarding({
      id: `id-${index}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      rejectionReason: null,
      context: { alias: 'a' },
    }),
  );

const createHarness = () => {
  const repository = {
    findWorkflowVersionsForAdmin: jest
      .fn()
      .mockResolvedValue([{ workflowKey: 'passport-check', version: 3 }]),
    findAdminExportBatch: jest.fn().mockResolvedValue([]),
  };
  const registry = {
    getDefinitionForAdmin: jest.fn().mockResolvedValue(createDefinition(['alias'])),
  };
  const audit = { logOnboardingsExport: jest.fn().mockResolvedValue(undefined) };
  const service = new OnboardingsExportService(
    dataSource,
    repository as unknown as OnboardingsRepository,
    registry as unknown as WorkflowRegistryService,
    audit as unknown as AuditService,
  );

  return { repository, registry, audit, service };
};

const collect = async (pending: Promise<AsyncGenerator<string>>): Promise<string[]> => {
  const chunks: string[] = [];
  for await (const chunk of await pending) {
    chunks.push(chunk);
  }
  return chunks;
};

describe('OnboardingsExportService', () => {
  it('resolves the columns, then writes the audit row, before any batch is read', async () => {
    const harness = createHarness();
    const filters = { status: 'approved' } as never;
    const order: string[] = [];
    harness.registry.getDefinitionForAdmin.mockImplementation(async () => {
      order.push('columns');
      return createDefinition(['alias']);
    });
    harness.audit.logOnboardingsExport.mockImplementation(async () => {
      order.push('audit');
    });

    const generator = await harness.service.exportCsv(filters, ACTOR_ID);

    expect(order).toEqual(['columns', 'audit']);
    expect(harness.audit.logOnboardingsExport).toHaveBeenCalledWith(dataSource, {
      actorId: ACTOR_ID,
      filters,
    });
    expect(harness.repository.findAdminExportBatch).not.toHaveBeenCalled();

    await collect(Promise.resolve(generator));

    expect(harness.repository.findAdminExportBatch).toHaveBeenCalled();
  });

  it('writes no audit row and rejects when the columns cannot be resolved', async () => {
    const harness = createHarness();
    harness.registry.getDefinitionForAdmin.mockRejectedValue(new Error('boom'));

    await expect(harness.service.exportCsv({}, ACTOR_ID)).rejects.toThrow('boom');
    expect(harness.audit.logOnboardingsExport).not.toHaveBeenCalled();
  });

  it('reads no batch when the audit write fails', async () => {
    const harness = createHarness();
    harness.audit.logOnboardingsExport.mockRejectedValue(new Error('audit down'));

    await expect(harness.service.exportCsv({}, ACTOR_ID)).rejects.toThrow('audit down');
    expect(harness.repository.findAdminExportBatch).not.toHaveBeenCalled();
  });

  it('yields only the BOM and header when nothing matches', async () => {
    const harness = createHarness();

    const chunks = await collect(harness.service.exportCsv({}, ACTOR_ID));

    expect(chunks).toEqual([`${CSV_BOM}${FIXED_HEADER},Alias,Other data\r\n`]);
    expect(harness.repository.findAdminExportBatch).toHaveBeenCalledTimes(1);
  });

  it('reads a second batch after a full one, cursored on the last id', async () => {
    const harness = createHarness();
    const rows = createRows(BATCH_SIZE + 1);
    harness.repository.findAdminExportBatch
      .mockResolvedValueOnce(rows.slice(0, BATCH_SIZE))
      .mockResolvedValueOnce(rows.slice(BATCH_SIZE));
    const filters = { status: 'awaiting_user' } as never;

    const chunks = await collect(harness.service.exportCsv(filters, ACTOR_ID));

    expect(harness.repository.findAdminExportBatch).toHaveBeenCalledTimes(2);
    expect(harness.repository.findAdminExportBatch).toHaveBeenNthCalledWith(
      1,
      manager,
      filters,
      null,
      BATCH_SIZE,
    );
    expect(harness.repository.findAdminExportBatch).toHaveBeenNthCalledWith(
      2,
      manager,
      filters,
      `id-${BATCH_SIZE - 1}`,
      BATCH_SIZE,
    );
    expect(chunks).toHaveLength(3);
    expect(chunks.slice(1).join('').split('\r\n')).toHaveLength(BATCH_SIZE + 2);
  });

  it.each([
    ['an unknown workflow', new WorkflowNotFoundException()],
    ['a vanished revision', new WorkflowRevisionNotFoundError('passport-check', 3)],
  ])('gives %s no columns and keeps its context in Other data', async (_name, error) => {
    const harness = createHarness();
    harness.registry.getDefinitionForAdmin.mockRejectedValue(error);
    harness.repository.findAdminExportBatch.mockResolvedValueOnce(createRows(1));

    const chunks = await collect(harness.service.exportCsv({}, ACTOR_ID));

    expect(chunks[0]).toBe(`${CSV_BOM}${FIXED_HEADER},Other data\r\n`);
    expect(chunks[1]).toContain('"{""alias"":""a""}"');
  });

  it('rethrows any other registry failure', async () => {
    const harness = createHarness();
    harness.registry.getDefinitionForAdmin.mockRejectedValue(new Error('boom'));

    await expect(harness.service.exportCsv({}, ACTOR_ID)).rejects.toThrow('boom');
  });

  it('builds columns from a retired version the registry still serves', async () => {
    const harness = createHarness();
    harness.repository.findWorkflowVersionsForAdmin.mockResolvedValue([
      { workflowKey: 'passport-check', version: 1 },
    ]);
    harness.registry.getDefinitionForAdmin.mockResolvedValue(createDefinition(['retiredField']));

    const chunks = await collect(harness.service.exportCsv({}, ACTOR_ID));

    expect(harness.registry.getDefinitionForAdmin).toHaveBeenCalledWith('passport-check', 1);
    expect(chunks[0]).toContain('Retired field');
  });
});
