import { Injectable } from '@nestjs/common';
import type { AuditEntry, MaskedAuditEntry } from '../../masking/masking.types';
import { RequestContext } from '../../request-context/request-context';
import { MILLISECONDS_PER_DAY } from '../../time.constants';
import { mapWithConcurrency } from '../shared/map-with-concurrency';
import { ENGINE_READ_CONCURRENCY } from '../shared/shared.constants';
import { findDateRange, findString } from '../shared/tool-arguments';
import { ToolError } from '../tool-error';
import {
  McpTool,
  ToolArguments,
  ToolInputSchema,
  ToolKind,
  ToolRegistration,
} from '../tool-registration';
import { AuditFilters, AuditReader } from './audit-reader';
import {
  ACCESS_ACTIONS,
  ACCESS_GRANTED_ACTION,
  ACCESS_REPORT_DEFAULT_WINDOW_DAYS,
  ACCESS_REPORT_EXPORT_LIST_LIMIT,
  ACCESS_REPORT_MAX_ENTRIES_PER_ACTION,
  ACCESS_UNAUTHENTICATED_ACTION,
  CONFIGURATION_ACTIONS,
  EXPORT_ACTION,
  MAX_FILTER_LENGTH,
} from './compliance.constants';

/** One actor's activity of one action in the window. */
export interface ActionSummary {
  actorType: string;
  actorId: string;
  action: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface ConfigurationSummary extends ActionSummary {
  /** The action's prefix: `workflow_draft`, `connector_settings`, `encryption`, ... */
  family: string;
}

export interface AccessReport {
  window: { from: string; to: string };
  actorId?: string;
  /** True when any part of the window was cut short; `truncatedActions` names the parts. */
  truncated: boolean;
  truncatedActions: string[];
  notes: string[];
  /** `auth.*` rows by actor; the action is the outcome (granted, token rejected, role missing, ...). */
  adminAccess: ActionSummary[];
  exports: { count: number; listed: number; entries: MaskedAuditEntry[] };
  configurationChanges: ConfigurationSummary[];
}

interface Collected {
  entries: AuditEntry[];
  truncatedActions: string[];
}

@Injectable()
@McpTool()
export class AccessReportTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'access_report';
  readonly description =
    'Reports, for a time window, who accessed the engine admin data, who exported onboarding data and ' +
    'who changed configuration, from the audit trail. `adminAccess` counts auth.* entries per actor and ' +
    'outcome (access granted, token rejected, role missing, verification unavailable, unauthenticated); ' +
    '`exports` lists each onboardings.exported with its filters; `configurationChanges` counts workflow, ' +
    'workflow draft, connector settings, encryption and agreement changes per actor, family and action. ' +
    'Every group has a count and its first and last occurrence. Use it for access reviews and audit ' +
    'questions such as "who exported data last month" or "what did this operator change". `actorId` ' +
    `narrows it to one actor; the window defaults to the last ${ACCESS_REPORT_DEFAULT_WINDOW_DAYS} days. ` +
    '`truncated` says whether the window was cut short, and `notes` explains anything unusual, such ' +
    'as admin authentication being switched off. For the individual entries behind a count, use search_audit.';
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: `Start of the window, inclusive: an ISO-8601 date or datetime. Defaults to ${ACCESS_REPORT_DEFAULT_WINDOW_DAYS} days before \`to\`.`,
      },
      to: {
        type: 'string',
        description:
          'End of the window, inclusive: an ISO-8601 date (a bare date includes that whole UTC day) or datetime. Defaults to now.',
      },
      actorId: {
        type: 'string',
        description: 'Only this actor, e.g. an operator object id.',
      },
    },
    additionalProperties: false,
  };

  constructor(private readonly audit: AuditReader) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<AccessReport> {
    const actorId = findString(args, 'actorId', MAX_FILTER_LENGTH);
    const range = findDateRange(args, 'from', 'to');
    const to = range.to ?? new Date();
    const from =
      range.from ??
      new Date(to.getTime() - ACCESS_REPORT_DEFAULT_WINDOW_DAYS * MILLISECONDS_PER_DAY);

    if (from > to) {
      throw new ToolError('from must not be later than to.');
    }

    const window = {
      actorId,
      occurredFrom: from.toISOString(),
      occurredTo: to.toISOString(),
    };
    // One group after another: each reads its actions with bounded concurrency, so the whole
    // report never has every action's scan in flight at once.
    const access = await this.collect(ACCESS_ACTIONS, window, context);
    const exported = await this.collect([EXPORT_ACTION], window, context);
    const configuration = await this.collect(CONFIGURATION_ACTIONS, window, context);
    const listed = exported.entries.slice(0, ACCESS_REPORT_EXPORT_LIST_LIMIT);
    const truncatedActions = [
      ...access.truncatedActions,
      ...exported.truncatedActions,
      ...configuration.truncatedActions,
    ];

    return {
      window: { from: window.occurredFrom, to: window.occurredTo },
      ...(actorId === undefined ? {} : { actorId }),
      truncated: truncatedActions.length > 0,
      truncatedActions,
      notes: this.describeAccess(access.entries),
      adminAccess: this.summarise(access.entries),
      exports: {
        count: exported.entries.length,
        listed: listed.length,
        entries: await this.audit.maskEntries(listed, context),
      },
      configurationChanges: this.summarise(configuration.entries).map((summary) => ({
        family: summary.action.slice(0, summary.action.indexOf('.')),
        ...summary,
      })),
    };
  }

  /** The engine filters by exact action, so each action is read on its own, a few at a time. */
  private async collect(
    actions: readonly string[],
    window: AuditFilters,
    context: RequestContext,
  ): Promise<Collected> {
    const scans = await mapWithConcurrency(actions, ENGINE_READ_CONCURRENCY, (action) =>
      this.audit.scan({ ...window, action }, context, {
        maxEntries: ACCESS_REPORT_MAX_ENTRIES_PER_ACTION,
      }),
    );

    return {
      entries: scans.flatMap(({ entries }) => entries),
      truncatedActions: actions.filter((_, index) => scans[index].truncated),
    };
  }

  private summarise(entries: readonly AuditEntry[]): ActionSummary[] {
    const groups = new Map<string, ActionSummary>();

    for (const { actorType, actorId, action, occurredAt } of entries) {
      const key = JSON.stringify([actorType, actorId, action]);
      const group = groups.get(key);

      if (group === undefined) {
        groups.set(key, {
          actorType,
          actorId,
          action,
          count: 1,
          firstAt: occurredAt,
          lastAt: occurredAt,
        });
        continue;
      }

      group.count += 1;
      group.firstAt =
        Date.parse(occurredAt) < Date.parse(group.firstAt) ? occurredAt : group.firstAt;
      group.lastAt = Date.parse(occurredAt) > Date.parse(group.lastAt) ? occurredAt : group.lastAt;
    }

    return [...groups.values()].sort(
      (a, b) =>
        a.actorType.localeCompare(b.actorType) ||
        a.actorId.localeCompare(b.actorId) ||
        a.action.localeCompare(b.action),
    );
  }

  private describeAccess(entries: readonly AuditEntry[]): string[] {
    const unauthenticated = entries.filter(
      ({ action }) => action === ACCESS_UNAUTHENTICATED_ACTION,
    ).length;

    if (entries.length === 0) {
      return [
        'No auth.* entries match: no admin request was recorded, so there is no access to report.',
      ];
    }

    if (unauthenticated === entries.length) {
      return [
        `Every access is ${ACCESS_UNAUTHENTICATED_ACTION}: admin authentication was switched off (ADMIN_AUTH_ENABLED=false), so requests are anonymous and no operator is identified. Expected on a local stack; in a deployed environment it is itself a finding.`,
      ];
    }

    const notes =
      unauthenticated > 0
        ? [
            `Some access is ${ACCESS_UNAUTHENTICATED_ACTION}: admin authentication was off for part of the window, so those requests identify no operator.`,
          ]
        : [];

    return entries.some(({ action }) => action === ACCESS_GRANTED_ACTION)
      ? notes
      : [
          ...notes,
          'No access was granted in the window; every recorded request was refused or failed.',
        ];
  }
}
