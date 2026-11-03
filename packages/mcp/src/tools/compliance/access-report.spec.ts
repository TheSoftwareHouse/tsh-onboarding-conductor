import { MILLISECONDS_PER_DAY } from '../../time.constants';
import { AccessReportTool } from './access-report.tool';
import { ToolError } from '../tool-error';
import {
  ACCESS_REPORT_DEFAULT_WINDOW_DAYS,
  ACCESS_REPORT_EXPORT_LIST_LIMIT,
  ACCESS_REPORT_MAX_ENTRIES_PER_ACTION,
} from './compliance.constants';
import { buildAuditEngine, buildReader, buildRow, CONTEXT } from './testing/audit-engine';

const NOW = new Date('2026-11-01T12:00:00.000Z');

const GRANTED = 'auth.access_granted';
const REJECTED = 'auth.token_rejected';
const UNAUTHENTICATED = 'auth.access_unauthenticated';
const EXPORTED = 'onboardings.exported';
const DRAFT_PUBLISHED = 'workflow_draft.published';
const CONNECTOR_SETTINGS_UPDATED = 'connector_settings.updated';

function buildTool(rows: ReturnType<typeof buildRow>[]) {
  const request = buildAuditEngine(rows);
  return { tool: new AccessReportTool(buildReader(request)), request };
}

describe('AccessReportTool', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts admin access per actor and outcome with first and last occurrence', async () => {
    const { tool } = buildTool([
      buildRow({ action: GRANTED, actorId: 'oid-ada', occurredAt: '2026-10-20T08:00:00.000Z' }),
      buildRow({ action: GRANTED, actorId: 'oid-ada', occurredAt: '2026-10-10T08:00:00.000Z' }),
      buildRow({ action: GRANTED, actorId: 'oid-ada', occurredAt: '2026-10-15T08:00:00.000Z' }),
      buildRow({ action: REJECTED, actorId: 'oid-ada', occurredAt: '2026-10-12T08:00:00.000Z' }),
      buildRow({ action: GRANTED, actorId: 'oid-bob', occurredAt: '2026-10-11T08:00:00.000Z' }),
    ]);

    const report = await tool.handler({}, CONTEXT);

    expect(report.adminAccess).toEqual([
      {
        actorType: 'operator',
        actorId: 'oid-ada',
        action: GRANTED,
        count: 3,
        firstAt: '2026-10-10T08:00:00.000Z',
        lastAt: '2026-10-20T08:00:00.000Z',
      },
      {
        actorType: 'operator',
        actorId: 'oid-ada',
        action: REJECTED,
        count: 1,
        firstAt: '2026-10-12T08:00:00.000Z',
        lastAt: '2026-10-12T08:00:00.000Z',
      },
      {
        actorType: 'operator',
        actorId: 'oid-bob',
        action: GRANTED,
        count: 1,
        firstAt: '2026-10-11T08:00:00.000Z',
        lastAt: '2026-10-11T08:00:00.000Z',
      },
    ]);
    expect(report.notes).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it('lists exports with their masked filters', async () => {
    const { tool } = buildTool([
      buildRow({
        action: EXPORTED,
        resourceType: 'onboardings_export',
        resourceId: 'onboardings',
        metadata: { workflowId: 'analyst-investigation', status: 'approved', email: 'a@b.example' },
      }),
    ]);

    const { exports } = await tool.handler({}, CONTEXT);

    expect(exports.count).toBe(1);
    expect(exports.entries).toHaveLength(1);
    expect(exports.entries[0].metadata).toEqual({
      workflowId: 'analyst-investigation',
      status: 'approved',
    });
  });

  it('caps the export listing but counts every export', async () => {
    const total = ACCESS_REPORT_EXPORT_LIST_LIMIT + 3;
    const rows = Array.from({ length: total }, (_, index) =>
      buildRow({
        action: EXPORTED,
        occurredAt: new Date(NOW.getTime() - (index + 1) * 1000).toISOString(),
      }),
    );
    const { tool } = buildTool(rows);

    const { exports } = await tool.handler({}, CONTEXT);

    expect(exports).toMatchObject({ count: total, listed: ACCESS_REPORT_EXPORT_LIST_LIMIT });
  });

  it('groups configuration changes by actor, family and action', async () => {
    const { tool } = buildTool([
      buildRow({ action: DRAFT_PUBLISHED, actorId: 'oid-ada' }),
      buildRow({ action: DRAFT_PUBLISHED, actorId: 'oid-ada' }),
      buildRow({ action: CONNECTOR_SETTINGS_UPDATED, actorId: 'oid-ada' }),
      buildRow({ action: 'encryption.key_added', actorId: 'oid-bob' }),
      buildRow({ action: 'onboarding.state_transition', actorId: 'engine' }),
    ]);

    const { configurationChanges } = await tool.handler({}, CONTEXT);

    expect(
      configurationChanges.map(({ actorId, family, action, count }) => [
        actorId,
        family,
        action,
        count,
      ]),
    ).toEqual([
      ['oid-ada', 'connector_settings', CONNECTOR_SETTINGS_UPDATED, 1],
      ['oid-ada', 'workflow_draft', DRAFT_PUBLISHED, 2],
      ['oid-bob', 'encryption', 'encryption.key_added', 1],
    ]);
  });

  it('says so when admin authentication was off and every access is anonymous', async () => {
    const { tool } = buildTool([
      buildRow({ action: UNAUTHENTICATED, actorType: 'anonymous', actorId: 'unknown' }),
      buildRow({ action: UNAUTHENTICATED, actorType: 'anonymous', actorId: 'unknown' }),
    ]);

    const report = await tool.handler({}, CONTEXT);

    expect(report.adminAccess).toMatchObject([
      { actorId: 'unknown', action: UNAUTHENTICATED, count: 2 },
    ]);
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain('ADMIN_AUTH_ENABLED=false');
  });

  it('reports an empty window without failing', async () => {
    const { tool } = buildTool([]);

    const report = await tool.handler({}, CONTEXT);

    expect(report).toMatchObject({
      adminAccess: [],
      exports: { count: 0, listed: 0, entries: [] },
      configurationChanges: [],
      truncated: false,
    });
    expect(report.notes[0]).toContain('No auth.* entries');
  });

  it('defaults the window to the last thirty days and applies from, to and actorId', async () => {
    const { tool, request } = buildTool([
      buildRow({ action: GRANTED, actorId: 'oid-ada', occurredAt: '2026-10-31T00:00:00.000Z' }),
      buildRow({ action: GRANTED, actorId: 'oid-ada', occurredAt: '2026-09-01T00:00:00.000Z' }),
      buildRow({ action: GRANTED, actorId: 'oid-bob', occurredAt: '2026-10-31T00:00:00.000Z' }),
    ]);

    const defaulted = await tool.handler({ actorId: 'oid-ada' }, CONTEXT);

    expect(defaulted.window).toEqual({
      from: new Date(
        NOW.getTime() - ACCESS_REPORT_DEFAULT_WINDOW_DAYS * MILLISECONDS_PER_DAY,
      ).toISOString(),
      to: NOW.toISOString(),
    });
    expect(defaulted.actorId).toBe('oid-ada');
    expect(defaulted.adminAccess).toMatchObject([{ actorId: 'oid-ada', count: 1 }]);
    expect(request).toHaveBeenCalledWith(
      'get',
      '/v1/admin/audit',
      CONTEXT,
      expect.objectContaining({ query: expect.objectContaining({ actorId: 'oid-ada' }) }),
    );

    const explicit = await tool.handler({ from: '2026-09-01', to: '2026-09-01' }, CONTEXT);

    expect(explicit.window).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-01T23:59:59.999Z',
    });
    expect(explicit.adminAccess).toMatchObject([{ actorId: 'oid-ada', count: 1 }]);
  });

  it('states which actions were cut short when the window is truncated', async () => {
    const rows = Array.from({ length: ACCESS_REPORT_MAX_ENTRIES_PER_ACTION + 1 }, (_, index) =>
      buildRow({
        action: GRANTED,
        occurredAt: new Date(NOW.getTime() - (index + 1) * 1000).toISOString(),
      }),
    );
    const { tool } = buildTool(rows);

    const report = await tool.handler({}, CONTEXT);

    expect(report.truncated).toBe(true);
    expect(report.truncatedActions).toEqual([GRANTED]);
    expect(report.adminAccess[0].count).toBe(ACCESS_REPORT_MAX_ENTRIES_PER_ACTION);
  });

  it('refuses a window that ends before it starts and unparseable instants', async () => {
    const { tool, request } = buildTool([]);

    await expect(tool.handler({ from: '2026-10-02', to: '2026-10-01' }, CONTEXT)).rejects.toThrow(
      ToolError,
    );
    await expect(tool.handler({ from: 'last tuesday' }, CONTEXT)).rejects.toThrow(ToolError);
    await expect(tool.handler({ actorId: 7 }, CONTEXT)).rejects.toThrow(ToolError);
    expect(request).not.toHaveBeenCalled();
  });
});
