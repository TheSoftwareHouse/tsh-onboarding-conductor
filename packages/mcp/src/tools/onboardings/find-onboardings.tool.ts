import { Injectable } from '@nestjs/common';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { RequestContext } from '../../request-context/request-context';
import { AGREEMENT_STATUSES, WORKFLOW_STATUSES } from '../shared/shared.constants';
import {
  findBoolean,
  findDateRange,
  findInteger,
  findOneOf,
  findString,
} from '../shared/tool-arguments';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { OnboardingSummary, toOnboardingSummary } from './onboarding-summary';

const DEFAULT_RESULT_LIMIT = 50;
const MAX_RESULT_LIMIT = 500;
/** Pages of the list read for one call, which bounds a date range that matches little or nothing. */
const MAX_PAGES_SCANNED = 50;

/**
 * Lists onboardings by the engine's filters plus a creation date range, which the engine's list
 * lacks: the list is newest first, so the range is applied here while paging, and reading stops
 * as soon as a row is older than the range.
 */
@McpTool()
@Injectable()
export class FindOnboardingsTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'find_onboardings';
  readonly description =
    'Lists onboardings as summary rows, newest first: id, workflow and version, status, current ' +
    'step, scores, rejection reason, agreement status, pending connector (when parked on a ' +
    'provider callback) and timestamps. Rows carry no applicant data. Use it to locate ' +
    'onboardings by status, workflow, step, parked state or creation date range before opening ' +
    'one with get_onboarding or get_onboarding_timeline. At most `limit` rows are returned ' +
    `(default ${DEFAULT_RESULT_LIMIT}, at most ${MAX_RESULT_LIMIT}); \`truncated\` is true when ` +
    'more rows match than were returned, so narrow the filters rather than treating the rows as ' +
    'the full population. For counts across the whole population use onboarding_stats.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      status: { type: 'string', enum: [...WORKFLOW_STATUSES], description: 'Only this status.' },
      workflowId: { type: 'string', description: 'Only onboardings of this workflow.' },
      workflowVersion: { type: 'integer', description: 'Only onboardings pinned to this version.' },
      currentStep: { type: 'string', description: 'Only onboardings waiting on this step.' },
      onboardingId: { type: 'string', description: 'Exactly this onboarding.' },
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
      parkedBefore: {
        type: 'string',
        description: 'Only onboardings parked before this ISO-8601 instant.',
      },
      createdFrom: {
        type: 'string',
        description: 'Only onboardings created at or after this ISO-8601 date or date-time.',
      },
      createdTo: {
        type: 'string',
        description:
          'Only onboardings created at or before this ISO-8601 date (a bare date includes that whole UTC day) or date-time.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_RESULT_LIMIT,
        description: `Rows to return (default ${DEFAULT_RESULT_LIMIT}).`,
      },
    },
    additionalProperties: false,
  };

  constructor(private readonly engine: EngineClient) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const filters = {
      status: findOneOf(args, 'status', WORKFLOW_STATUSES),
      workflowId: findString(args, 'workflowId'),
      workflowVersion: findInteger(args, 'workflowVersion'),
      currentStep: findString(args, 'currentStep'),
      onboardingId: findString(args, 'onboardingId'),
      agreementStatus: findOneOf(args, 'agreementStatus', AGREEMENT_STATUSES),
      parked: findBoolean(args, 'parked'),
      pendingConnectorId: findString(args, 'pendingConnectorId'),
      parkedBefore: findString(args, 'parkedBefore'),
    };
    const { from: createdFrom, to: createdTo } = findDateRange(args, 'createdFrom', 'createdTo');
    const limit =
      findInteger(args, 'limit', { min: 1, max: MAX_RESULT_LIMIT }) ?? DEFAULT_RESULT_LIMIT;

    // One row beyond the limit tells whether more matches exist.
    const matches: OnboardingSummary[] = [];
    let scanCapReached = false;
    let done = false;

    for (let page = 1; !done; page++) {
      if (page > MAX_PAGES_SCANNED) {
        scanCapReached = true;
        break;
      }

      const { items, meta } = await this.engine.request('get', '/v1/onboardings', context, {
        query: { ...filters, page, limit: ENGINE_PAGE_SIZE },
      });

      for (const row of items) {
        const created = Date.parse(row.createdAt);

        if (createdFrom !== undefined && created < createdFrom.getTime()) {
          done = true;
          break;
        }
        if (createdTo !== undefined && created > createdTo.getTime()) {
          continue;
        }

        matches.push(toOnboardingSummary(row));

        if (matches.length > limit) {
          done = true;
          break;
        }
      }

      done ||= page >= meta.pagination.totalPages;
    }

    const truncated = matches.length > limit || scanCapReached;

    return {
      items: matches.slice(0, limit),
      returned: Math.min(matches.length, limit),
      truncated,
      ...(truncated
        ? {
            truncationNote: scanCapReached
              ? `Stopped after reading ${MAX_PAGES_SCANNED * ENGINE_PAGE_SIZE} onboardings; matches beyond that are not shown. Narrow the filters or the date range.`
              : `More onboardings match than the ${limit} returned. Narrow the filters or the date range, or raise limit (at most ${MAX_RESULT_LIMIT}).`,
          }
        : {}),
    };
  }
}
