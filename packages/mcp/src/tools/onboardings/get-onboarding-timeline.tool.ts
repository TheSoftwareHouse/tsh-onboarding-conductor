import { Injectable } from '@nestjs/common';
import { FieldClassLookup } from '../../classification/field-class-lookup';
import { collectPages } from '../../engine/collect-pages';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { Masker } from '../../masking/masker';
import type { AuditEntry } from '../../masking/masking.types';
import { RequestContext } from '../../request-context/request-context';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { describeCompileFailures } from './compile-warnings';
import { buildTimeline } from './onboarding-timeline';
import { toOnboardingSummary } from './onboarding-summary';
import { getOnboardingId } from './onboarding-arguments';

/** Pages of audit rows read for one onboarding; far beyond any real history, so it only bounds a runaway. */
const MAX_AUDIT_PAGES = 20;

/**
 * The history of one onboarding in time order: the engine's transitions merged with its audit
 * rows, each audit row masked by the onboarding's own field classes before it is shown.
 */
@McpTool()
@Injectable()
export class GetOnboardingTimelineTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'get_onboarding_timeline';
  readonly description =
    'Returns the full history of one onboarding, oldest first, as a single list of events: start, ' +
    'every status or step move with the scores before and after it, connector outcomes and ' +
    'failures, rejected attempts, provider callbacks, operator reconciles and reviewer ' +
    'decisions, each with its time and masked detail. Use it first when asked why an onboarding ' +
    'was rejected, is stuck, is parked or is in manual review: the deciding event is the move to ' +
    'the terminal or review status and the connector or callback event just before it. Event ' +
    'kind `other` is housekeeping such as suppressed notifications. Applicant-entered values ' +
    'never appear; contact data shows as a pseudonym and free text is withheld.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      onboardingId: { type: 'string', description: 'The onboarding UUID, from find_onboardings.' },
    },
    required: ['onboardingId'],
    additionalProperties: false,
  };

  constructor(
    private readonly engine: EngineClient,
    private readonly fieldClasses: FieldClassLookup,
    private readonly masker: Masker,
  ) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const onboardingId = getOnboardingId(args);
    const summary = toOnboardingSummary(
      await this.engine.request('get', '/v1/onboardings/{id}', context, {
        path: { id: onboardingId },
      }),
    );
    const [transitions, audit, versionClasses] = await Promise.all([
      this.engine.request('get', '/v1/onboardings/{id}/transitions', context, {
        path: { id: onboardingId },
      }),
      this.readAuditEntries(onboardingId, context),
      this.fieldClasses.getVersionClasses(
        { workflowId: summary.workflowId, version: summary.workflowVersion },
        context,
      ),
    ]);
    const events = buildTimeline(
      audit.entries.map((entry) => this.masker.maskAuditEntry(entry, versionClasses.classes)),
      transitions.items,
    );
    const warnings = [
      ...describeCompileFailures(
        versionClasses.compileFailure === undefined
          ? []
          : [
              {
                workflowId: summary.workflowId,
                version: summary.workflowVersion,
                reason: versionClasses.compileFailure,
              },
            ],
      ),
      ...(audit.truncated
        ? [
            `Only the newest ${MAX_AUDIT_PAGES * ENGINE_PAGE_SIZE} audit rows were read; earlier events are missing.`,
          ]
        : []),
    ];

    return {
      onboarding: summary,
      events,
      truncated: audit.truncated,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** Newest first, as the audit API serves them, up to the page cap. */
  private async readAuditEntries(
    onboardingId: string,
    context: RequestContext,
  ): Promise<{ entries: AuditEntry[]; truncated: boolean }> {
    const { items, truncated } = await collectPages(
      (page) =>
        this.engine.request('get', '/v1/admin/audit', context, {
          query: { resourceId: onboardingId, page, limit: ENGINE_PAGE_SIZE },
        }),
      MAX_AUDIT_PAGES,
    );

    return { entries: items, truncated };
  }
}
