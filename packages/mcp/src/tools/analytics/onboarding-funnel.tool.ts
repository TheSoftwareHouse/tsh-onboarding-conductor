import { Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import { collectPages } from '../../engine/collect-pages';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { Masker } from '../../masking/masker';
import { RequestContext } from '../../request-context/request-context';
import { MILLISECONDS_PER_SECOND } from '../../time.constants';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { ONBOARDING_RESOURCE_TYPE } from '../shared/shared.constants';
import { findDateRange, findInteger, getString } from '../shared/tool-arguments';
import {
  FUNNEL_AUDIT_ACTIONS,
  MAX_PAGES_PER_QUERY,
  ONBOARDING_STARTED_ACTION,
} from './analytics.constants';
import { findMedian } from './statistics';

type AuditEntry = components['schemas']['AuditEventResponseDto'];

/** One move of an onboarding between steps, read from a lifecycle audit row. */
interface Move {
  onboardingId: string;
  id: string;
  at: number;
  /** Absent on `onboarding.started`: the onboarding was not anywhere before. */
  leftStep: string | null;
  /** Null when the move ended the onboarding. */
  enteredStep: string | null;
  toStatus: string;
}

interface StepTally {
  reached: Set<string>;
  movedTo: Map<string, number>;
  ended: Map<string, number>;
  abandoned: number;
  secondsInStep: number[];
}

export interface FunnelStep {
  step: string;
  /** Onboardings seen entering or leaving the step in the window. */
  reached: number;
  /** Onboardings that left the step for each next step. */
  movedTo: Record<string, number>;
  /** Onboardings the step ended, by terminal status. */
  ended: Record<string, number>;
  /** Onboardings whose latest move left them on this step, not terminal. */
  abandoned: number;
  medianSecondsInStep: number | null;
}

/**
 * Reconstructs where onboardings of one workflow went, step by step, from the lifecycle rows of
 * the audit log: starts, state transitions and manual review decisions. The audit API has no
 * workflow filter, so the rows are paged for the window and narrowed here by the workflow and
 * version each row records.
 */
@McpTool()
@Injectable()
export class OnboardingFunnelTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'onboarding_funnel';
  readonly description =
    'Shows how onboardings of one workflow moved through its steps in a time window: per step, ' +
    'how many reached it, how many moved on to each next step, how many ended there as ' +
    'approved, rejected or invalid, how many are still waiting there (abandoned), and the median ' +
    'seconds spent in the step. Use it to find where applicants drop off or stall, and to see ' +
    'whether a step is slow. Needs workflowId; version narrows to one revision; from and to ' +
    'bound the window by ISO-8601 date or date-time (the audit log is read for the window only, ' +
    'so a wide window on a busy system may be cut: `truncated` is true then, and the counts ' +
    'cover the most recent rows). "Abandoned" is judged at the end of the window and an ' +
    'onboarding that is parked on a provider callback counts as waiting. Counts are of ' +
    'onboardings that had activity in the window, not of every onboarding of the workflow.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      workflowId: { type: 'string', description: 'The workflow to analyse.' },
      version: { type: 'integer', description: 'Only this workflow revision (default: all).' },
      from: {
        type: 'string',
        description: 'Window start, an ISO-8601 date or date-time (default: unbounded).',
      },
      to: {
        type: 'string',
        description: 'Window end, an ISO-8601 date or date-time (default: unbounded).',
      },
    },
    required: ['workflowId'],
    additionalProperties: false,
  };

  constructor(
    private readonly engine: EngineClient,
    private readonly masker: Masker,
  ) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const workflowId = getString(args, 'workflowId');
    const version = findInteger(args, 'version');
    const { from, to } = findDateRange(args, 'from', 'to');

    const reads = await Promise.all(
      FUNNEL_AUDIT_ACTIONS.map((action) =>
        collectPages<AuditEntry>(
          (page) =>
            this.engine.request('get', '/v1/admin/audit', context, {
              query: {
                action,
                resourceType: ONBOARDING_RESOURCE_TYPE,
                occurredFrom: from?.toISOString(),
                occurredTo: to?.toISOString(),
                page,
                limit: ENGINE_PAGE_SIZE,
              },
            }),
          MAX_PAGES_PER_QUERY,
          { getKey: (entry) => entry.id },
        ),
      ),
    );

    const moves = reads
      .flatMap(({ items }) => items)
      .map((entry) => this.masker.maskAuditEntry(entry))
      .filter(
        ({ metadata }) =>
          metadata.workflowId === workflowId &&
          (version === undefined || metadata.workflowVersion === version),
      )
      .map((entry): Move => ({
        onboardingId: entry.resourceId,
        id: entry.id,
        at: Date.parse(entry.occurredAt),
        leftStep:
          entry.action === ONBOARDING_STARTED_ACTION
            ? null
            : (entry.metadata.fromCurrentStep as string | null),
        enteredStep: entry.metadata.toCurrentStep as string | null,
        toStatus: String(entry.metadata.toStatus),
      }));

    return {
      workflowId,
      ...(version === undefined ? {} : { version }),
      ...(from ? { from: from.toISOString() } : {}),
      ...(to ? { to: to.toISOString() } : {}),
      onboardings: new Set(moves.map(({ onboardingId }) => onboardingId)).size,
      steps: this.tally(moves),
      truncated: reads.some(({ truncated }) => truncated),
    };
  }

  private tally(moves: readonly Move[]): FunnelStep[] {
    const tallies = new Map<string, StepTally>();
    const entrySteps: string[] = [];
    const getTally = (step: string): StepTally => {
      const tally = tallies.get(step) ?? {
        reached: new Set(),
        movedTo: new Map(),
        ended: new Map(),
        abandoned: 0,
        secondsInStep: [],
      };
      tallies.set(step, tally);
      return tally;
    };
    const increment = (counts: Map<string, number>, key: string): void => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };

    const byOnboarding = new Map<string, Move[]>();
    for (const move of moves) {
      byOnboarding.set(move.onboardingId, [...(byOnboarding.get(move.onboardingId) ?? []), move]);
    }

    for (const [onboardingId, history] of byOnboarding) {
      const enteredAt = new Map<string, number>();
      let current: string | null = null;

      for (const move of [...history].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
        const { leftStep, enteredStep } = move;

        // A move that keeps the onboarding on its step - parking on a connector - changes nothing.
        if (leftStep !== null && leftStep === enteredStep) {
          continue;
        }

        if (leftStep !== null) {
          const left = getTally(leftStep);
          left.reached.add(onboardingId);
          const since = enteredAt.get(leftStep);
          if (since !== undefined) {
            left.secondsInStep.push((move.at - since) / MILLISECONDS_PER_SECOND);
            enteredAt.delete(leftStep);
          }
          increment(enteredStep === null ? left.ended : left.movedTo, enteredStep ?? move.toStatus);
        } else if (enteredStep !== null) {
          entrySteps.push(enteredStep);
        }

        if (enteredStep !== null) {
          getTally(enteredStep).reached.add(onboardingId);
          enteredAt.set(enteredStep, move.at);
        }
        current = enteredStep;
      }

      if (current !== null) {
        getTally(current).abandoned++;
      }
    }

    return this.orderSteps(tallies, entrySteps).map((step) => {
      const { reached, movedTo, ended, abandoned, secondsInStep } = tallies.get(step)!;
      const median = findMedian(secondsInStep);

      return {
        step,
        reached: reached.size,
        movedTo: Object.fromEntries(movedTo),
        ended: Object.fromEntries(ended),
        abandoned,
        medianSecondsInStep: median === undefined ? null : Math.round(median),
      };
    });
  }

  /** Steps in the order an onboarding meets them: breadth first from where onboardings start. */
  private orderSteps(
    tallies: ReadonlyMap<string, StepTally>,
    entrySteps: readonly string[],
  ): string[] {
    const ordered = new Set<string>();
    const queue = [...new Set(entrySteps)];

    for (const step of queue) {
      if (ordered.has(step)) {
        continue;
      }
      ordered.add(step);
      queue.push(...(tallies.get(step)?.movedTo.keys() ?? []));
    }

    return [...ordered, ...[...tallies.keys()].filter((step) => !ordered.has(step))];
  }
}
