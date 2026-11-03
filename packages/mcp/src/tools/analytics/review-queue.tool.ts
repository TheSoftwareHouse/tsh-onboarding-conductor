import { Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import { collectPages } from '../../engine/collect-pages';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { RequestContext } from '../../request-context/request-context';
import { MILLISECONDS_PER_SECOND } from '../../time.constants';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { findString } from '../shared/tool-arguments';
import { MAX_PAGES_PER_QUERY, MAX_QUEUE_ITEMS } from './analytics.constants';

type OnboardingSummary = components['schemas']['AdminOnboardingSummaryResponseDto'];

const QueueReason = { MANUAL_REVIEW: 'awaiting_manual_review', PARKED: 'parked' } as const;
type QueueReason = (typeof QueueReason)[keyof typeof QueueReason];

interface QueueEntry {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  reasons: QueueReason[];
  status: string;
  currentStep: string | null;
  scores: Record<string, number>;
  pendingConnector: { connectorId: string; parkedAt: string | null } | null;
  createdAt: string;
  /** Seconds since `waitingSince`. */
  ageSeconds: number;
  /** When the wait began: the park time for a parked onboarding, else its creation. */
  waitingSince: string;
}

/** The onboardings that need someone's attention: awaiting a manual decision, or parked on a provider. */
@McpTool()
@Injectable()
export class ReviewQueueTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'review_queue';
  readonly description =
    'Lists the onboardings waiting on a person or a provider, oldest first: those awaiting ' +
    'manual review and those parked on an asynchronous connector (waiting for its callback). ' +
    'Each entry gives the workflow, status, current step, scores, the pending connector and when ' +
    'it was parked, and its age in seconds: since parking for a parked onboarding, otherwise ' +
    'since creation. Use it to find what is stuck or ageing, and to pick onboardings to open with ' +
    'get_onboarding_timeline. workflowId narrows to one workflow. At most ' +
    `${MAX_QUEUE_ITEMS} entries are returned; \`total\` is the full count and \`truncated\` is ` +
    'true when entries were left out. Entries carry no applicant data.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      workflowId: { type: 'string', description: 'Only onboardings of this workflow.' },
    },
    additionalProperties: false,
  };

  constructor(private readonly engine: EngineClient) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const workflowId = findString(args, 'workflowId');
    const readQueue = (filter: { status: 'awaiting_manual_review' } | { parked: true }) =>
      collectPages(
        (page) =>
          this.engine.request('get', '/v1/onboardings', context, {
            query: { ...filter, workflowId, page, limit: ENGINE_PAGE_SIZE },
          }),
        MAX_PAGES_PER_QUERY,
        { getKey: (onboarding) => onboarding.onboardingId },
      );

    const [review, parked] = await Promise.all([
      readQueue({ status: 'awaiting_manual_review' }),
      readQueue({ parked: true }),
    ]);

    const now = Date.now();
    const entries = new Map<string, QueueEntry>();

    const addEntry = (onboarding: OnboardingSummary, reason: QueueReason): void => {
      const known = entries.get(onboarding.onboardingId);
      if (known) {
        known.reasons.push(reason);
        return;
      }

      const waitingSince = onboarding.pendingConnector?.parkedAt ?? onboarding.createdAt;
      entries.set(onboarding.onboardingId, {
        onboardingId: onboarding.onboardingId,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        reasons: [reason],
        status: onboarding.status,
        currentStep: onboarding.currentStep,
        scores: onboarding.scores,
        pendingConnector: onboarding.pendingConnector && {
          connectorId: onboarding.pendingConnector.connectorId,
          parkedAt: onboarding.pendingConnector.parkedAt,
        },
        createdAt: onboarding.createdAt,
        ageSeconds: Math.floor((now - Date.parse(waitingSince)) / MILLISECONDS_PER_SECOND),
        waitingSince,
      });
    };

    review.items.forEach((onboarding) => addEntry(onboarding, QueueReason.MANUAL_REVIEW));
    parked.items.forEach((onboarding) => addEntry(onboarding, QueueReason.PARKED));

    const oldestFirst = [...entries.values()].sort((a, b) => b.ageSeconds - a.ageSeconds);

    return {
      total: oldestFirst.length,
      items: oldestFirst.slice(0, MAX_QUEUE_ITEMS),
      truncated: oldestFirst.length > MAX_QUEUE_ITEMS || review.truncated || parked.truncated,
    };
  }
}
