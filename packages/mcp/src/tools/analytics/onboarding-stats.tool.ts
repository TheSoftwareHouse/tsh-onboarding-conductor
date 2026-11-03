import { Injectable } from '@nestjs/common';
import { humanizeKey } from '../../masking/csv-columns';
import { CSV_SCORE_HEADER_SUFFIX } from '../../masking/masking.constants';
import type { MaskedRecord, MaskedValue } from '../../masking/masking.types';
import { RequestContext } from '../../request-context/request-context';
import { ToolError } from '../tool-error';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { AGREEMENT_STATUSES, WORKFLOW_STATUSES } from '../shared/shared.constants';
import {
  findBoolean,
  findDateRange,
  findInteger,
  findOneOf,
  findString,
  getString,
} from '../shared/tool-arguments';
import { MAX_EXPORT_ROWS, NO_VALUE_GROUP } from './analytics.constants';
import {
  ExportColumn,
  type ExportedRows,
  type ExportFilters,
  OnboardingExportRows,
} from './onboarding-export-rows';
import { findSpread, type Spread } from './statistics';

const BUILT_IN_GROUPINGS = [
  'status',
  'currentStep',
  'workflowVersion',
  'rejectionReason',
  'day',
] as const;
type BuiltInGrouping = (typeof BUILT_IN_GROUPINGS)[number];

const DAY_LENGTH = 'YYYY-MM-DD'.length;

const GROUPING_COLUMNS: Record<Exclude<BuiltInGrouping, 'day'>, string> = {
  status: ExportColumn.STATUS,
  currentStep: ExportColumn.CURRENT_STEP,
  workflowVersion: ExportColumn.WORKFLOW_VERSION,
  rejectionReason: ExportColumn.REJECTION_REASON,
};

interface Group {
  count: number;
  scores: Map<string, number[]>;
}

export interface StatsGroup {
  group: string;
  count: number;
  /** Min, median and max of each score the workflow declares, over the rows that carry one. */
  scores: Record<string, Spread>;
}

/**
 * Counts onboardings by a chosen dimension, with the spread of each score per group. It reads the
 * engine's CSV export once per caller and filter set, masks every row before counting, and keeps
 * the masked rows for a few minutes so a follow-up grouping does not export again.
 */
@McpTool()
@Injectable()
export class OnboardingStatsTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'onboarding_stats';
  readonly description =
    'Counts onboardings across the whole population, grouped by one dimension, with the minimum, ' +
    'median and maximum of every score per group. Use it for "how many", "what share" and "where ' +
    'do scores sit" questions: how many were rejected and why (groupBy rejectionReason), where ' +
    'live onboardings are waiting (currentStep), how volume moved day by day (day), or how a ' +
    'workflow version compares with another (workflowVersion). groupBy can also name an ' +
    'enumerated collected field such as country or sourceOfFunds; fields that carry personal ' +
    'data (names, emails, dates of birth) are refused. Filter by status, workflow, version, ' +
    'step, agreement status or parked connector, and narrow by creation date with createdFrom ' +
    'and createdTo. The numbers cover every matching onboarding, not a sample; `truncated` is ' +
    `true only when the population exceeds ${MAX_EXPORT_ROWS} rows. To look at individual ` +
    'onboardings use find_onboardings.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      groupBy: {
        type: 'string',
        description:
          `One of ${BUILT_IN_GROUPINGS.join(', ')}, or the name of an enumerated collected field ` +
          'such as country or sourceOfFunds.',
      },
      status: { type: 'string', enum: [...WORKFLOW_STATUSES], description: 'Only this status.' },
      workflowId: { type: 'string', description: 'Only onboardings of this workflow.' },
      workflowVersion: { type: 'integer', description: 'Only onboardings pinned to this version.' },
      currentStep: { type: 'string', description: 'Only onboardings waiting on this step.' },
      agreementStatus: {
        type: 'string',
        enum: [...AGREEMENT_STATUSES],
        description: 'Only onboardings whose derived agreement status is this.',
      },
      parked: {
        type: 'boolean',
        description: 'true: only onboardings parked on a provider callback; false: only the rest.',
      },
      pendingConnectorId: {
        type: 'string',
        description: 'Only onboardings parked on this connector.',
      },
      createdFrom: {
        type: 'string',
        description: 'Only onboardings created at or after this ISO-8601 date or date-time.',
      },
      createdTo: {
        type: 'string',
        description: 'Only onboardings created at or before this ISO-8601 date or date-time.',
      },
    },
    required: ['groupBy'],
    additionalProperties: false,
  };

  constructor(private readonly exportRows: OnboardingExportRows) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const groupBy = getString(args, 'groupBy');
    const filters: ExportFilters = {
      status: findOneOf(args, 'status', WORKFLOW_STATUSES),
      workflowId: findString(args, 'workflowId'),
      workflowVersion: findInteger(args, 'workflowVersion'),
      currentStep: findString(args, 'currentStep'),
      agreementStatus: findOneOf(args, 'agreementStatus', AGREEMENT_STATUSES),
      parked: findBoolean(args, 'parked'),
      pendingConnectorId: findString(args, 'pendingConnectorId'),
    };
    const { from, to } = findDateRange(args, 'createdFrom', 'createdTo');

    const exported = await this.exportRows.getRows(filters, context);
    const getGroupKey = this.getGrouping(groupBy, exported);

    const groups = new Map<string, Group>();
    let matched = 0;

    for (const row of exported.rows) {
      const createdAt = Date.parse(String(row[ExportColumn.CREATED_AT]));
      if ((from && !(createdAt >= from.getTime())) || (to && !(createdAt <= to.getTime()))) {
        continue;
      }

      matched++;
      const key = getGroupKey(row);
      const group = groups.get(key) ?? { count: 0, scores: new Map() };
      group.count++;
      groups.set(key, group);

      for (const [name, value] of Object.entries(row)) {
        const score = Number(value);
        if (name.endsWith(CSV_SCORE_HEADER_SUFFIX) && value !== null && Number.isFinite(score)) {
          const label = name.slice(0, -CSV_SCORE_HEADER_SUFFIX.length);
          const scores = group.scores.get(label) ?? [];
          scores.push(score);
          group.scores.set(label, scores);
        }
      }
    }

    return {
      groupBy,
      matched,
      groups: [...groups]
        .map(([group, { count, scores }]) => ({
          group,
          count,
          scores: Object.fromEntries(
            [...scores].flatMap(([name, values]) => {
              const spread = findSpread(values);
              return spread ? [[name, spread]] : [];
            }),
          ),
        }))
        .sort(
          groupBy === 'day'
            ? (a, b) => a.group.localeCompare(b.group)
            : (a, b) => b.count - a.count || a.group.localeCompare(b.group),
        ),
      truncated: exported.truncated,
      ...(exported.failures.length > 0
        ? {
            notes: exported.failures.map(
              ({ workflowId, version }) =>
                `${workflowId} version ${version} does not compile, so its collected fields are left out of every grouping.`,
            ),
          }
        : {}),
    };
  }

  /** How a masked row maps to its group; refuses a field that does not pass in clear. */
  private getGrouping(groupBy: string, exported: ExportedRows): (row: MaskedRecord) => string {
    if (groupBy === 'day') {
      return (row) =>
        toGroupKey(row[ExportColumn.CREATED_AT])?.slice(0, DAY_LENGTH) ?? NO_VALUE_GROUP;
    }

    const builtIn = Object.hasOwn(GROUPING_COLUMNS, groupBy)
      ? GROUPING_COLUMNS[groupBy as keyof typeof GROUPING_COLUMNS]
      : undefined;
    const header =
      builtIn ?? exported.headers.find((h) => h === groupBy || h === humanizeKey(groupBy));

    if (header === undefined) {
      throw new ToolError(
        `Cannot group by ${groupBy}: the export has no such field. Use one of ${BUILT_IN_GROUPINGS.join(', ')}` +
          `${this.describePassFields(exported)}.`,
      );
    }
    if (builtIn === undefined && !exported.passHeaders.has(header)) {
      throw new ToolError(
        `Cannot group by ${groupBy}: it is personal data or is not classified as safe to show, so it is masked or dropped.` +
          ` Use one of ${BUILT_IN_GROUPINGS.join(', ')}${this.describePassFields(exported)}.`,
      );
    }

    return (row) => toGroupKey(row[header]) ?? NO_VALUE_GROUP;
  }

  private describePassFields({ passHeaders }: ExportedRows): string {
    const fields = [...passHeaders].filter((header) => !header.endsWith(CSV_SCORE_HEADER_SUFFIX));

    return fields.length === 0 ? '' : `, or a field that passes in clear: ${fields.join(', ')}`;
  }
}

function toGroupKey(value: MaskedValue | undefined): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}
