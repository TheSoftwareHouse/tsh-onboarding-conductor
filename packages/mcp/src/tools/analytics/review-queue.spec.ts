import type { components } from '@tsh/openapi';
import { EngineClient } from '../../engine/engine-client';
import { RequestContext } from '../../request-context/request-context';
import { MILLISECONDS_PER_MINUTE, SECONDS_PER_MINUTE } from '../../time.constants';
import { MAX_QUEUE_ITEMS } from './analytics.constants';
import { ReviewQueueTool } from './review-queue.tool';

type OnboardingSummary = components['schemas']['AdminOnboardingSummaryResponseDto'];

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
interface QueueItem {
  onboardingId: string;
  ageSeconds: number;
  reasons: string[];
}

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

function summary(
  id: string,
  minutesAgo: number,
  overrides: Partial<OnboardingSummary> = {},
): OnboardingSummary {
  return {
    onboardingId: id,
    workflowId: 'analyst-investigation',
    workflowVersion: 1,
    status: 'awaiting_user',
    currentStep: 'check_identity',
    createdAt: new Date(NOW - minutesAgo * MILLISECONDS_PER_MINUTE).toISOString(),
    scores: { risk: 20 },
    pendingConnector: null,
    ...overrides,
  } as OnboardingSummary;
}

describe('review_queue', () => {
  let request: jest.Mock;
  let tool: ReviewQueueTool;
  let review: OnboardingSummary[];
  let parked: OnboardingSummary[];

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    review = [
      summary('review-new', 30, {
        status: 'awaiting_manual_review',
        currentStep: 'review_identity',
      }),
      summary('review-old', 600, {
        status: 'awaiting_manual_review',
        currentStep: 'review_identity',
      }),
    ];
    const parkedAt = new Date(NOW - 120 * MILLISECONDS_PER_MINUTE).toISOString();
    parked = [
      summary('parked', 900, {
        pendingConnector: {
          connectorId: 'sumsub',
          connectorName: 'sumsub',
          connectorOrder: 1,
          parkedAt,
        },
      }),
    ];
    request = jest.fn(
      (
        _method: string,
        _path: string,
        _context: RequestContext,
        args: { query: { parked?: boolean } },
      ) =>
        Promise.resolve({
          items: args.query.parked ? parked : review,
          meta: { pagination: { totalPages: 1 } },
        }),
    );
    tool = new ReviewQueueTool({ request } as unknown as EngineClient);
  });

  it('lists review and parked onboardings oldest first, aged from the park time when parked', async () => {
    const result = (await tool.handler({}, CONTEXT)) as {
      total: number;
      items: QueueItem[];
      truncated: boolean;
    };

    expect(result.truncated).toBe(false);
    expect(result.total).toBe(3);
    expect(
      result.items.map(({ onboardingId, ageSeconds, reasons }) => [
        onboardingId,
        ageSeconds,
        reasons,
      ]),
    ).toEqual([
      ['review-old', 600 * SECONDS_PER_MINUTE, ['awaiting_manual_review']],
      ['parked', 120 * SECONDS_PER_MINUTE, ['parked']],
      ['review-new', 30 * SECONDS_PER_MINUTE, ['awaiting_manual_review']],
    ]);
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        currentStep: 'check_identity',
        pendingConnector: expect.objectContaining({ connectorId: 'sumsub' }),
      }),
    );
  });

  it('lists an onboarding that is both once, with both reasons', async () => {
    parked = [
      {
        ...review[0],
        pendingConnector: {
          connectorId: 'sumsub',
          connectorName: 'sumsub',
          connectorOrder: 1,
          parkedAt: null,
        },
      },
    ];

    const result = (await tool.handler({}, CONTEXT)) as { total: number; items: QueueItem[] };

    expect(result.items.find(({ onboardingId }) => onboardingId === 'review-new')?.reasons).toEqual(
      ['awaiting_manual_review', 'parked'],
    );
    expect(result.total).toBe(2);
  });

  it('narrows to a workflow through the engine filters', async () => {
    await tool.handler({ workflowId: 'other' }, CONTEXT);

    for (const [, , , args] of request.mock.calls) {
      expect(args.query.workflowId).toBe('other');
    }
  });

  it('returns at most the item cap and says so', async () => {
    review = Array.from({ length: MAX_QUEUE_ITEMS + 5 }, (_, index) =>
      summary(`r-${index}`, index + 1, { status: 'awaiting_manual_review' }),
    );

    const result = (await tool.handler({}, CONTEXT)) as {
      total: number;
      items: unknown[];
      truncated: boolean;
    };

    expect(result.items).toHaveLength(MAX_QUEUE_ITEMS);
    expect(result.total).toBe(MAX_QUEUE_ITEMS + 6);
    expect(result.truncated).toBe(true);
  });
});
