import type { components } from '@tsh/openapi';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { Masker } from '../../masking/masker';
import { RequestContext } from '../../request-context/request-context';
import { MILLISECONDS_PER_MINUTE } from '../../time.constants';
import { ToolError } from '../tool-error';
import { MAX_PAGES_PER_QUERY } from './analytics.constants';
import { OnboardingFunnelTool } from './onboarding-funnel.tool';

type AuditEntry = components['schemas']['AuditEventResponseDto'];

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
const WORKFLOW = 'analyst-investigation';
const START = Date.UTC(2026, 9, 1, 10, 0, 0);

let sequence = 0;

function lifecycleEntry(
  action: AuditEntry['action'],
  onboardingId: string,
  minutes: number,
  move: { from: string | null; to: string | null; toStatus: string; version?: number },
  workflowId = WORKFLOW,
): AuditEntry {
  sequence += 1;
  return {
    id: `entry-${String(sequence).padStart(4, '0')}`,
    occurredAt: new Date(START + minutes * MILLISECONDS_PER_MINUTE).toISOString(),
    actorType: 'system',
    actorId: 'engine',
    action,
    resourceType: 'onboarding',
    resourceId: onboardingId,
    metadata: {
      workflowId,
      workflowVersion: move.version ?? 1,
      fromCurrentStep: move.from,
      toCurrentStep: move.to,
      toStatus: move.toStatus,
      applicantEmail: 'leak@example.com',
    },
  };
}

const started = (id: string, minutes: number, to = 'collect', version?: number, wf?: string) =>
  lifecycleEntry(
    'onboarding.started',
    id,
    minutes,
    { from: null, to, toStatus: 'awaiting_user', version },
    wf,
  );
const moved = (
  id: string,
  minutes: number,
  from: string,
  to: string | null,
  toStatus = 'awaiting_user',
  workflowId?: string,
) => lifecycleEntry('onboarding.state_transition', id, minutes, { from, to, toStatus }, workflowId);

describe('onboarding_funnel', () => {
  let entriesByAction: Record<string, AuditEntry[][]>;
  let request: jest.Mock;
  let tool: OnboardingFunnelTool;

  beforeEach(() => {
    sequence = 0;
    entriesByAction = {};
    request = jest.fn(
      (
        _method: string,
        _path: string,
        _context: RequestContext,
        args: { query: { action: string; page: number } },
      ) => {
        const pages = entriesByAction[args.query.action] ?? [[]];
        return Promise.resolve({
          items: pages[args.query.page - 1] ?? [],
          meta: {
            pagination: {
              page: args.query.page,
              limit: ENGINE_PAGE_SIZE,
              total: 0,
              totalPages: pages.length,
            },
          },
        });
      },
    );
    tool = new OnboardingFunnelTool(
      { request } as unknown as EngineClient,
      new Masker('k'.repeat(32)),
    );
  });

  // a: collect -> verify -> approved; b: collect -> verify, then stays; c: collect, then stays;
  // d: collect -> verify -> review -> manual decision rejected; e: another workflow.
  function seedFlows(): void {
    entriesByAction['onboarding.started'] = [
      [
        started('a', 0),
        started('b', 1),
        started('c', 2),
        started('d', 3),
        started('e', 4, 'collect', 1, 'other-workflow'),
      ],
    ];
    entriesByAction['onboarding.state_transition'] = [
      [
        moved('a', 2, 'collect', 'verify'),
        moved('a', 12, 'verify', null, 'approved'),
        moved('b', 5, 'collect', 'verify'),
        moved('d', 4, 'collect', 'verify'),
        moved('d', 10, 'verify', 'review', 'awaiting_manual_review'),
        moved('e', 6, 'collect', 'verify', 'awaiting_user', 'other-workflow'),
        // Parking on the same step changes nothing.
        moved('b', 6, 'verify', 'verify'),
      ],
    ];
    entriesByAction['onboarding.manual_review_decision'] = [
      [
        lifecycleEntry('onboarding.manual_review_decision', 'd', 40, {
          from: 'review',
          to: null,
          toStatus: 'rejected',
        }),
      ],
    ];
  }

  it('reports reach, moves, ends, abandonment and median time in step', async () => {
    seedFlows();

    const result = (await tool.handler({ workflowId: WORKFLOW }, CONTEXT)) as {
      onboardings: number;
      steps: unknown[];
      truncated: boolean;
    };

    expect(result.onboardings).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.steps).toEqual([
      {
        step: 'collect',
        reached: 4,
        movedTo: { verify: 3 },
        ended: {},
        abandoned: 1,
        // a: 2 min, b: 4 min, d: 1 min.
        medianSecondsInStep: 120,
      },
      {
        step: 'verify',
        reached: 3,
        movedTo: { review: 1 },
        ended: { approved: 1 },
        abandoned: 1,
        // a: 10 min, d: 6 min; b is still there.
        medianSecondsInStep: 480,
      },
      {
        step: 'review',
        reached: 1,
        movedTo: {},
        ended: { rejected: 1 },
        abandoned: 0,
        medianSecondsInStep: 1800,
      },
    ]);
  });

  it('keeps only the version asked for', async () => {
    seedFlows();
    entriesByAction['onboarding.started'][0].push(started('f', 20, 'collect', 2));

    const result = (await tool.handler({ workflowId: WORKFLOW, version: 2 }, CONTEXT)) as {
      onboardings: number;
      steps: Array<{ step: string; reached: number; abandoned: number }>;
    };

    expect(result.onboardings).toBe(1);
    expect(result.steps).toEqual([
      expect.objectContaining({ step: 'collect', reached: 1, abandoned: 1 }),
    ]);
  });

  it('passes the window to the audit API and reads only onboarding lifecycle rows', async () => {
    await tool.handler({ workflowId: WORKFLOW, from: '2026-10-01', to: '2026-10-31' }, CONTEXT);

    const queries = request.mock.calls.map(([, , , args]) => args.query);
    expect(queries.map(({ action }) => action).sort()).toEqual([
      'onboarding.manual_review_decision',
      'onboarding.started',
      'onboarding.state_transition',
    ]);
    for (const query of queries) {
      expect(query).toEqual(
        expect.objectContaining({
          resourceType: 'onboarding',
          occurredFrom: '2026-10-01T00:00:00.000Z',
          occurredTo: '2026-10-31T23:59:59.999Z',
          limit: ENGINE_PAGE_SIZE,
        }),
      );
    }
  });

  it('reads every page and counts a row that moved between pages once', async () => {
    const first = started('a', 0);
    entriesByAction['onboarding.started'] = [
      [first, started('b', 1)],
      [first, started('c', 2)],
    ];

    const result = (await tool.handler({ workflowId: WORKFLOW }, CONTEXT)) as {
      onboardings: number;
      truncated: boolean;
    };

    expect(result.onboardings).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('reports truncated when the page cap leaves rows unread', async () => {
    entriesByAction['onboarding.started'] = Array.from(
      { length: MAX_PAGES_PER_QUERY + 1 },
      (_, index) => [started(`onboarding-${index}`, index)],
    );

    const result = (await tool.handler({ workflowId: WORKFLOW }, CONTEXT)) as {
      onboardings: number;
      truncated: boolean;
    };

    expect(result.truncated).toBe(true);
    expect(result.onboardings).toBe(MAX_PAGES_PER_QUERY);
  });

  it('never returns metadata outside the lifecycle allowlist', async () => {
    seedFlows();

    const result = await tool.handler({ workflowId: WORKFLOW }, CONTEXT);

    expect(JSON.stringify(result)).not.toContain('leak@example.com');
  });

  it('requires a workflow and refuses a window that ends before it starts', async () => {
    await expect(tool.handler({}, CONTEXT)).rejects.toThrow(ToolError);
    await expect(
      tool.handler({ workflowId: WORKFLOW, from: '2026-10-31', to: '2026-10-01' }, CONTEXT),
    ).rejects.toThrow(/must not be later/);
  });
});
