import type { components } from '@tsh/openapi';
import { EngineClient } from '../../engine/engine-client';
import { RequestContext } from '../../request-context/request-context';
import { MILLISECONDS_PER_HOUR } from '../../time.constants';
import { ToolError } from '../tool-error';
import { FindOnboardingsTool } from './find-onboardings.tool';

type Row = components['schemas']['AdminOnboardingSummaryResponseDto'];

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
const PAGE_SIZE = 100;
const ENDLESS_ROWS = 1_000_000;
const START = Date.parse('2026-10-31T00:00:00Z');

/** Row `n` was created `n` hours after START; the engine lists newest first, so ids run downwards. */
function rowCreatedHoursAfterStart(n: number): Row {
  return {
    onboardingId: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    workflowId: 'analyst-investigation',
    workflowVersion: 1,
    status: 'awaiting_user',
    currentStep: 'collect_profile',
    expiresAt: null,
    createdAt: new Date(START + n * MILLISECONDS_PER_HOUR).toISOString(),
    updatedAt: new Date(START + n * MILLISECONDS_PER_HOUR).toISOString(),
    completedAt: null,
    rejectionReason: null,
    scores: { risk: 0 },
    agreementStatus: 'not_accepted',
    pendingConnector: null,
  };
}

describe('FindOnboardingsTool', () => {
  const population = Array.from({ length: 250 }, (_, index) => 249 - index).map(
    rowCreatedHoursAfterStart,
  );
  let request: jest.Mock;
  let tool: FindOnboardingsTool;

  beforeEach(() => {
    request = jest.fn((_method: string, _path: string, _context: RequestContext, args) => {
      const { page, limit } = args.query;
      return Promise.resolve({
        items: population.slice((page - 1) * limit, page * limit),
        meta: {
          pagination: {
            page,
            limit,
            total: population.length,
            totalPages: Math.ceil(population.length / limit),
          },
        },
      });
    });
    tool = new FindOnboardingsTool({ request } as unknown as EngineClient);
  });

  it('applies the date range and stops reading once rows are older than the range', async () => {
    const result = (await tool.handler(
      {
        createdFrom: new Date(START + 200 * MILLISECONDS_PER_HOUR).toISOString(),
        createdTo: new Date(START + 210 * MILLISECONDS_PER_HOUR).toISOString(),
      },
      CONTEXT,
    )) as { items: Array<{ createdAt: string }>; returned: number; truncated: boolean };

    expect(result.returned).toBe(11);
    expect(result.truncated).toBe(false);
    expect(result.items[0].createdAt).toBe(
      new Date(START + 210 * MILLISECONDS_PER_HOUR).toISOString(),
    );
    expect(result.items.at(-1)?.createdAt).toBe(
      new Date(START + 200 * MILLISECONDS_PER_HOUR).toISOString(),
    );
    // Rows 249..150 fill page 1 and row 199 there is already older than the range.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('treats a bare createdTo date as the whole UTC day, as createdFrom starts at its first instant', async () => {
    const result = (await tool.handler(
      { createdFrom: '2026-10-31', createdTo: '2026-10-31', limit: 500 },
      CONTEXT,
    )) as { items: Array<{ createdAt: string }>; returned: number };

    // Rows 0..23 were created between 2026-10-31T00:00Z and 23:00Z.
    expect(result.returned).toBe(24);
    expect(result.items[0].createdAt).toBe('2026-10-31T23:00:00.000Z');
    expect(result.items.at(-1)?.createdAt).toBe('2026-10-31T00:00:00.000Z');
  });

  it('keeps a date-time createdTo exact', async () => {
    const result = (await tool.handler(
      { createdFrom: '2026-10-31', createdTo: '2026-10-31T05:00:00Z', limit: 500 },
      CONTEXT,
    )) as { returned: number };

    expect(result.returned).toBe(6);
  });

  it('refuses a range that ends before it starts', async () => {
    await expect(
      tool.handler({ createdFrom: '2026-11-02', createdTo: '2026-11-01' }, CONTEXT),
    ).rejects.toThrow('createdFrom must not be later than createdTo.');
    expect(request).not.toHaveBeenCalled();
  });

  it('reads on to a second page when the range reaches it', async () => {
    const result = (await tool.handler(
      { createdFrom: new Date(START + 140 * MILLISECONDS_PER_HOUR).toISOString(), limit: 500 },
      CONTEXT,
    )) as { returned: number; truncated: boolean };

    expect(result.returned).toBe(110);
    expect(result.truncated).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reports truncation when more rows match than the limit', async () => {
    const result = (await tool.handler({ limit: 5 }, CONTEXT)) as {
      items: unknown[];
      returned: number;
      truncated: boolean;
      truncationNote: string;
    };

    expect(result.items).toHaveLength(5);
    expect(result.returned).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.truncationNote).toContain('More onboardings match');
  });

  it('is not truncated when exactly the limit matches', async () => {
    const result = (await tool.handler(
      { createdFrom: new Date(START + 245 * MILLISECONDS_PER_HOUR).toISOString(), limit: 5 },
      CONTEXT,
    )) as { returned: number; truncated: boolean };

    expect(result.returned).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it('stops at the page cap when a range matches nothing the engine can short-circuit', async () => {
    request.mockImplementation((_m, _p, _c, args) =>
      Promise.resolve({
        items: Array.from({ length: PAGE_SIZE }, () => rowCreatedHoursAfterStart(1000)),
        meta: {
          pagination: {
            page: args.query.page,
            limit: PAGE_SIZE,
            total: ENDLESS_ROWS,
            totalPages: ENDLESS_ROWS / PAGE_SIZE,
          },
        },
      }),
    );

    const result = (await tool.handler({ createdTo: new Date(START).toISOString() }, CONTEXT)) as {
      returned: number;
      truncated: boolean;
      truncationNote: string;
    };

    expect(result.returned).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.truncationNote).toContain('Narrow the filters');
    expect(request.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it('passes the engine filters through and drops fields the summary does not name', async () => {
    request.mockResolvedValueOnce({
      items: [{ ...rowCreatedHoursAfterStart(1), email: 'a@example.com' }],
      meta: { pagination: { page: 1, limit: PAGE_SIZE, total: 1, totalPages: 1 } },
    });

    const result = (await tool.handler(
      { status: 'rejected', workflowId: 'wf', parked: false, workflowVersion: 2 },
      CONTEXT,
    )) as { items: object[] };

    expect(request.mock.calls[0][3].query).toMatchObject({
      status: 'rejected',
      workflowId: 'wf',
      parked: false,
      workflowVersion: 2,
      page: 1,
      limit: PAGE_SIZE,
    });
    expect(JSON.stringify(result)).not.toContain('a@example.com');
    expect(result.items[0]).not.toHaveProperty('expiresAt');
  });

  it.each([
    [{ status: 'done' }],
    [{ limit: 501 }],
    [{ limit: 0 }],
    [{ createdFrom: 'yesterday' }],
    [{ parked: 'yes' }],
    [{ createdFrom: '2026-11-02', createdTo: '2026-11-01' }],
  ])('refuses invalid arguments %j', async (args) => {
    await expect(tool.handler(args, CONTEXT)).rejects.toThrow(ToolError);
    expect(request).not.toHaveBeenCalled();
  });
});
