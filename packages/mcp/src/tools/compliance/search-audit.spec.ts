import { ToolError } from '../tool-error';
import { EngineError } from '../../engine/engine-error';
import { SEARCH_AUDIT_MAX_ENTRIES } from './compliance.constants';
import {
  buildAuditEngine,
  buildReader,
  buildRow,
  CONTEXT,
  PAGE_SIZE,
} from './testing/audit-engine';
import { SearchAuditTool } from './search-audit.tool';

const ONBOARDING_ID = '01a19540-420f-740e-98ae-1aa84ace68ab';
const ANALYST_CLASSES = new Map([['providerVerdict', { class: 'pass' as const }]]);

function onboardingRow(action: string, minute: number, metadata: Record<string, unknown> = {}) {
  return buildRow({
    action,
    actorType: 'system',
    actorId: 'engine',
    resourceType: 'onboarding',
    resourceId: ONBOARDING_ID,
    occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 59 - minute)).toISOString(),
    metadata,
  });
}

describe('SearchAuditTool', () => {
  it('returns the entries of one onboarding, newest first, with metadata reduced by allowlist', async () => {
    const request = buildAuditEngine([
      onboardingRow('onboarding.state_transition', 0, {
        workflowId: 'analyst-investigation',
        workflowVersion: 1,
        toStatus: 'approved',
        internalNote: 'must not pass',
      }),
      buildRow({ action: 'onboarding.started', resourceType: 'onboarding', resourceId: 'other' }),
    ]);
    const tool = new SearchAuditTool(buildReader(request));

    const result = await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT);

    expect(request).toHaveBeenCalledWith(
      'get',
      '/v1/admin/audit',
      CONTEXT,
      expect.objectContaining({
        query: expect.objectContaining({ resourceType: 'onboarding', resourceId: ONBOARDING_ID }),
      }),
    );
    expect(result).toMatchObject({ count: 1, truncated: false });
    expect(result.entries[0].metadata).toEqual({
      workflowId: 'analyst-investigation',
      workflowVersion: 1,
      toStatus: 'approved',
    });
  });

  it('applies actionPrefix here and keeps paging past rows that do not match', async () => {
    const rows = [
      ...Array.from({ length: PAGE_SIZE + 5 }, (_, index) =>
        onboardingRow('onboarding.state_transition', index),
      ),
      onboardingRow('connector.result_rejected', PAGE_SIZE + 6),
    ];
    const request = buildAuditEngine(rows);
    const tool = new SearchAuditTool(buildReader(request));

    const result = await tool.handler({ actionPrefix: 'connector.' }, CONTEXT);

    expect(result.entries.map(({ action }) => action)).toEqual(['connector.result_rejected']);
    expect(result.truncated).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('truncates at the entry cap and says so', async () => {
    const rows = Array.from({ length: SEARCH_AUDIT_MAX_ENTRIES + 1 }, (_, index) =>
      onboardingRow('onboarding.state_transition', index),
    );
    const tool = new SearchAuditTool(buildReader(buildAuditEngine(rows)));

    const result = await tool.handler({}, CONTEXT);

    expect(result.entries).toHaveLength(SEARCH_AUDIT_MAX_ENTRIES);
    expect(result.truncated).toBe(true);
    expect(result.note).toContain('Narrow the time window');
  });

  it('is not truncated when exactly the cap matches', async () => {
    const rows = Array.from({ length: SEARCH_AUDIT_MAX_ENTRIES }, (_, index) =>
      onboardingRow('onboarding.state_transition', index),
    );
    const tool = new SearchAuditTool(buildReader(buildAuditEngine(rows)));

    const result = await tool.handler({}, CONTEXT);

    expect(result).toMatchObject({ count: SEARCH_AUDIT_MAX_ENTRIES, truncated: false });
  });

  describe('masking submitted data', () => {
    const callback = onboardingRow('webhook.inbound_callback_applied', 0, {
      outcome: 'persisted',
      submittedData: { providerVerdict: 'approve', email: 'zofia@example.com' },
    });
    const pending = (extra: jest.Mock) => buildAuditEngine([callback, callback], extra);

    it('masks with the classes of the onboarding, looked up once per onboarding', async () => {
      const onboarding = jest.fn(() =>
        Promise.resolve({ workflowId: 'analyst-investigation', workflowVersion: 1 }),
      );
      const getVersionClasses = jest.fn(() => Promise.resolve({ classes: ANALYST_CLASSES }));
      const tool = new SearchAuditTool(buildReader(pending(onboarding), getVersionClasses));

      const result = await tool.handler({}, CONTEXT);

      expect(result.entries.map(({ metadata }) => metadata.submittedData)).toEqual([
        { providerVerdict: 'approve' },
        { providerVerdict: 'approve' },
      ]);
      expect(onboarding).toHaveBeenCalledTimes(1);
      expect(getVersionClasses).toHaveBeenCalledWith(
        { workflowId: 'analyst-investigation', version: 1 },
        CONTEXT,
      );
    });

    it('uses the version a row names without asking the engine for the onboarding', async () => {
      const onboarding = jest.fn();
      const getVersionClasses = jest.fn(() => Promise.resolve({ classes: ANALYST_CLASSES }));
      const named = {
        ...callback,
        metadata: { ...callback.metadata, workflowId: 'analyst-investigation', workflowVersion: 2 },
      };
      const tool = new SearchAuditTool(
        buildReader(buildAuditEngine([named], onboarding), getVersionClasses),
      );

      await tool.handler({}, CONTEXT);

      expect(onboarding).not.toHaveBeenCalled();
      expect(getVersionClasses).toHaveBeenCalledWith(
        { workflowId: 'analyst-investigation', version: 2 },
        CONTEXT,
      );
    });

    it('drops submitted data when the onboarding cannot be resolved', async () => {
      const onboarding = jest.fn(() => Promise.reject(new EngineError('Not found (404).', 404)));
      const tool = new SearchAuditTool(buildReader(pending(onboarding)));

      const result = await tool.handler({}, CONTEXT);

      expect(result.entries.map(({ metadata }) => metadata.submittedData)).toEqual([{}, {}]);
      expect(JSON.stringify(result)).not.toContain('zofia@example.com');
    });
  });

  it('refuses conflicting or malformed filters without calling the engine', async () => {
    const request = buildAuditEngine([]);
    const tool = new SearchAuditTool(buildReader(request));

    await expect(
      tool.handler({ onboardingId: ONBOARDING_ID, resourceId: 'x' }, CONTEXT),
    ).rejects.toThrow(ToolError);
    await expect(
      tool.handler({ occurredFrom: '2026-10-02', occurredTo: '2026-10-01' }, CONTEXT),
    ).rejects.toThrow('occurredFrom must not be later');
    await expect(tool.handler({ action: 5 }, CONTEXT)).rejects.toThrow(ToolError);
    expect(request).not.toHaveBeenCalled();
  });
});
