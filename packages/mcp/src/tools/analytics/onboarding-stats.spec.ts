import { FieldClassLookup } from '../../classification/field-class-lookup';
import { ANALYST_INVESTIGATION_COMPILED } from '../../classification/testing/analyst-investigation.fixture';
import { EngineClient } from '../../engine/engine-client';
import { buildCsvColumnClasses } from '../../masking/csv-columns';
import { FieldClassifier } from '../../masking/field-classifier';
import { Masker } from '../../masking/masker';
import { ToolLimits, ToolRateLimitError } from '../../limits/tool-limits';
import { RequestContext } from '../../request-context/request-context';
import { MILLISECONDS_PER_MINUTE, MILLISECONDS_PER_SECOND } from '../../time.constants';
import { ToolError } from '../tool-error';
import { EXPORT_ROWS_TTL_MS, MAX_EXPORT_ROWS } from './analytics.constants';
import { OnboardingExportRows } from './onboarding-export-rows';
import { OnboardingStatsTool } from './onboarding-stats.tool';

const ANALYST: RequestContext = {
  identity: { kind: 'user', objectId: 'oid-analyst', upn: 'analyst@example.com' },
};
const OTHER_ANALYST: RequestContext = {
  identity: { kind: 'user', objectId: 'oid-other', upn: 'other@example.com' },
};

/**
 * Aggregating a full export takes about a second; copying a group's scores per row made it take
 * more than ten, so this bound separates the two without being tight.
 */
const LARGE_EXPORT_TIMEOUT_MS = 8 * MILLISECONDS_PER_SECOND;

const HEADERS = [
  'Onboarding id',
  'Workflow id',
  'Workflow version',
  'Status',
  'Current step',
  'Agreement status',
  'Rejection reason',
  'Created at',
  'Updated at',
  'Completed at',
  'Risk score',
  'First name',
  'Date of birth',
  'Country',
  'Email',
  'Source of funds',
  'Other data',
];

function toRow(fields: {
  id: string;
  status: string;
  step?: string;
  reason?: string;
  createdAt: string;
  risk: number;
  firstName: string;
  country: string;
  email: string;
  sourceOfFunds?: string;
}): string {
  return [
    fields.id,
    'analyst-investigation',
    '1',
    fields.status,
    fields.step ?? '',
    'not_accepted',
    fields.reason ?? '',
    fields.createdAt,
    fields.createdAt,
    '',
    String(fields.risk),
    `"${fields.firstName}, the ""Third"""`,
    '1980-05-17',
    fields.country,
    fields.email,
    fields.sourceOfFunds ?? 'salary',
    '',
  ].join(',');
}

const ROWS = [
  toRow({
    id: 'a',
    status: 'rejected',
    reason: 'DOCUMENT_FORGED',
    createdAt: '2026-10-01T10:00:00.000Z',
    risk: 60,
    firstName: 'Alicia',
    country: 'RU',
    email: 'alicia@example.com',
  }),
  toRow({
    id: 'b',
    status: 'rejected',
    reason: 'DOCUMENT_FORGED',
    createdAt: '2026-10-01T18:00:00.000Z',
    risk: 80,
    firstName: 'Bertram',
    country: 'IR',
    email: 'bertram@example.com',
  }),
  toRow({
    id: 'c',
    status: 'approved',
    createdAt: '2026-10-02T09:00:00.000Z',
    risk: 0,
    firstName: 'Cordelia',
    country: 'PL',
    email: 'cordelia@example.com',
  }),
  toRow({
    id: 'd',
    status: 'awaiting_user',
    step: 'check_identity',
    createdAt: '2026-10-03T09:00:00.000Z',
    risk: 20,
    firstName: 'Dominik',
    country: 'PL',
    email: 'dominik@example.com',
  }),
];
const CSV = `${HEADERS.join(',')}\n${ROWS.join('\n')}\n`;

const RAW_PERSONAL_VALUES = ['Alicia', 'Bertram', 'Cordelia', 'Dominik', '@example.com', '1980-05'];

function streamOf(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;

  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

describe('onboarding_stats', () => {
  let openStream: jest.Mock;
  let maskCsvRow: jest.SpyInstance;
  let exportRows: OnboardingExportRows;
  let tool: OnboardingStatsTool;

  beforeEach(() => {
    const classifier = new FieldClassifier(['country', 'nationality']);
    const masker = new Masker('k'.repeat(32), () => new Date('2026-11-01T00:00:00Z'));
    const lookup = {
      getCsvColumnClasses: jest.fn((headers: string[]) =>
        Promise.resolve({
          columns: buildCsvColumnClasses(
            headers,
            classifier.classify(ANALYST_INVESTIGATION_COMPILED),
          ),
          failures: [],
        }),
      ),
    } as unknown as FieldClassLookup;

    openStream = jest.fn(() => Promise.resolve(streamOf(CSV, 37)));
    maskCsvRow = jest.spyOn(masker, 'maskCsvRow');
    exportRows = new OnboardingExportRows(
      { openStream } as unknown as EngineClient,
      lookup,
      masker,
      new ToolLimits(),
    );
    tool = new OnboardingStatsTool(exportRows);
  });

  it('counts per status with the spread of each score', async () => {
    const result = await tool.handler({ groupBy: 'status' }, ANALYST);

    expect(result).toEqual({
      groupBy: 'status',
      matched: 4,
      groups: [
        {
          group: 'rejected',
          count: 2,
          scores: { Risk: { count: 2, min: 60, median: 70, max: 80 } },
        },
        {
          group: 'approved',
          count: 1,
          scores: { Risk: { count: 1, min: 0, median: 0, max: 0 } },
        },
        {
          group: 'awaiting_user',
          count: 1,
          scores: { Risk: { count: 1, min: 20, median: 20, max: 20 } },
        },
      ],
      truncated: false,
    });
  });

  it('groups by rejection reason, leaving rows without one in their own group (equal counts by name)', async () => {
    const result = (await tool.handler({ groupBy: 'rejectionReason' }, ANALYST)) as {
      groups: Array<{ group: string; count: number }>;
    };

    expect(result.groups.map(({ group, count }) => [group, count])).toEqual([
      ['(none)', 2],
      ['DOCUMENT_FORGED', 2],
    ]);
  });

  it('groups by creation day in date order and applies the date range', async () => {
    const result = (await tool.handler(
      { groupBy: 'day', createdFrom: '2026-10-01', createdTo: '2026-10-02' },
      ANALYST,
    )) as { matched: number; groups: Array<{ group: string; count: number }> };

    expect(result.matched).toBe(3);
    expect(result.groups.map(({ group, count }) => [group, count])).toEqual([
      ['2026-10-01', 2],
      ['2026-10-02', 1],
    ]);
  });

  it('groups by a field that passes in clear, named by field name or column label', async () => {
    const byName = (await tool.handler({ groupBy: 'sourceOfFunds' }, ANALYST)) as {
      groups: Array<{ group: string; count: number }>;
    };
    const byCountry = (await tool.handler({ groupBy: 'country' }, ANALYST)) as {
      groups: Array<{ group: string; count: number }>;
    };

    expect(byName.groups).toEqual([expect.objectContaining({ group: 'salary', count: 4 })]);
    expect(byCountry.groups.map(({ group, count }) => [group, count])).toEqual([
      ['PL', 2],
      ['IR', 1],
      ['RU', 1],
    ]);
  });

  it.each(['email', 'dateOfBirth', 'firstName', 'otherData'])(
    'refuses to group by %s, which does not pass in clear',
    async (field) => {
      await expect(tool.handler({ groupBy: field }, ANALYST)).rejects.toThrow(ToolError);
    },
  );

  it('refuses a field the export does not have, naming what can be grouped', async () => {
    await expect(tool.handler({ groupBy: 'shoeSize' }, ANALYST)).rejects.toThrow(
      /no such field.*status.*Country/,
    );
  });

  it(
    'aggregates a full export of rows in one group',
    async () => {
      const scoreCycle = 100;
      const rows = Array.from({ length: MAX_EXPORT_ROWS }, (_, index) =>
        toRow({
          id: String(index),
          status: 'approved',
          createdAt: '2026-10-01T10:00:00.000Z',
          risk: index % scoreCycle,
          firstName: 'Alicia',
          country: 'PL',
          email: 'alicia@example.com',
        }),
      );
      openStream.mockResolvedValue(streamOf(`${HEADERS.join(',')}\n${rows.join('\n')}\n`, 65_536));

      const result = await tool.handler({ groupBy: 'status' }, ANALYST);

      expect(result).toEqual({
        groupBy: 'status',
        matched: MAX_EXPORT_ROWS,
        groups: [
          {
            group: 'approved',
            count: MAX_EXPORT_ROWS,
            scores: {
              Risk: { count: MAX_EXPORT_ROWS, min: 0, median: (scoreCycle - 1) / 2, max: 99 },
            },
          },
        ],
        truncated: false,
      });
    },
    LARGE_EXPORT_TIMEOUT_MS,
  );

  it('masks every row before it is cached or counted', async () => {
    const result = await tool.handler({ groupBy: 'status' }, ANALYST);
    const { rows } = await exportRows.getRows({}, ANALYST);

    expect(maskCsvRow).toHaveBeenCalledTimes(ROWS.length);
    expect(rows).toHaveLength(ROWS.length);
    for (const personalValue of RAW_PERSONAL_VALUES) {
      expect(JSON.stringify(rows)).not.toContain(personalValue);
      expect(JSON.stringify(result)).not.toContain(personalValue);
    }
    expect(rows[0]).toEqual(
      expect.objectContaining({ Email: expect.stringMatching(/^email:[0-9a-f]+$/), Country: 'RU' }),
    );
    expect(rows[0]).not.toHaveProperty('First name');
    expect(rows[0]).not.toHaveProperty('Other data');
  });

  describe('cache', () => {
    it('reuses the masked rows for the same caller and filters, whatever the grouping or dates', async () => {
      await tool.handler({ groupBy: 'status', status: 'rejected' }, ANALYST);
      await tool.handler(
        { groupBy: 'day', status: 'rejected', createdFrom: '2026-10-01' },
        ANALYST,
      );

      expect(openStream).toHaveBeenCalledTimes(1);
      expect(openStream).toHaveBeenCalledWith(
        '/v1/onboardings/export',
        ANALYST,
        expect.objectContaining({ query: expect.objectContaining({ status: 'rejected' }) }),
      );
    });

    it('exports again for other filters and for another caller', async () => {
      await tool.handler({ groupBy: 'status' }, ANALYST);
      await tool.handler({ groupBy: 'status', status: 'approved' }, ANALYST);
      await tool.handler({ groupBy: 'status' }, OTHER_ANALYST);

      expect(openStream).toHaveBeenCalledTimes(3);
    });

    it('exports again once the time to live has passed', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 1));
      await tool.handler({ groupBy: 'status' }, ANALYST);

      now.mockReturnValue(Date.UTC(2026, 10, 1) + EXPORT_ROWS_TTL_MS - MILLISECONDS_PER_MINUTE);
      await tool.handler({ groupBy: 'status' }, ANALYST);
      expect(openStream).toHaveBeenCalledTimes(1);

      now.mockReturnValue(Date.UTC(2026, 10, 1) + EXPORT_ROWS_TTL_MS + 1);
      await tool.handler({ groupBy: 'status' }, ANALYST);
      expect(openStream).toHaveBeenCalledTimes(2);
    });
  });

  describe('export slot', () => {
    it('is released when the export fails, so the next call can run', async () => {
      openStream.mockRejectedValueOnce(new ToolError('The engine could not be reached.'));

      await expect(tool.handler({ groupBy: 'status' }, ANALYST)).rejects.toThrow(
        'The engine could not be reached.',
      );
      await expect(tool.handler({ groupBy: 'status' }, ANALYST)).resolves.toBeDefined();
    });

    it('refuses a second export for the caller while one is running', async () => {
      let release: () => void = () => undefined;
      openStream.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve(streamOf(CSV, 64));
        }),
      );

      const running = tool.handler({ groupBy: 'status' }, ANALYST);
      await expect(
        tool.handler({ groupBy: 'status', status: 'approved' }, ANALYST),
      ).rejects.toThrow(ToolRateLimitError);

      release();
      await expect(running).resolves.toBeDefined();
    });
  });
});
