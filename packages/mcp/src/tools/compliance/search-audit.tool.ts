import { Injectable } from '@nestjs/common';
import { MaskedAuditEntry } from '../../masking/masking.types';
import { RequestContext } from '../../request-context/request-context';
import { ONBOARDING_RESOURCE_TYPE } from '../shared/shared.constants';
import { findDateRange, findString } from '../shared/tool-arguments';
import { ToolError } from '../tool-error';
import {
  McpTool,
  ToolArguments,
  ToolInputSchema,
  ToolKind,
  ToolRegistration,
} from '../tool-registration';
import { AuditReader } from './audit-reader';
import {
  MAX_TYPE_LENGTH,
  MAX_FILTER_LENGTH,
  SEARCH_AUDIT_MAX_ENTRIES,
} from './compliance.constants';

export interface SearchAuditResult {
  /** Newest first. */
  entries: MaskedAuditEntry[];
  count: number;
  truncated: boolean;
  note?: string;
}

@Injectable()
@McpTool()
export class SearchAuditTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'search_audit';
  readonly description =
    "Searches the engine's audit trail and returns the matching entries, newest first, each with its time, " +
    'actor (type and id), action, resource and masked metadata. Use it to see who did what and when: ' +
    'everything that happened to one onboarding (`onboardingId`), every action of one operator (`actorId`), ' +
    'one kind of event (`action`, or `actionPrefix` such as `connector.` or `workflow_draft.`), inside a ' +
    'time window (`occurredFrom`, `occurredTo`). All filters combine. Metadata is reduced to the keys ' +
    'the action family allows and personal data inside it is masked or dropped. At most ' +
    `${SEARCH_AUDIT_MAX_ENTRIES} entries come back; when \`truncated\` is true narrow the window or ` +
    'add filters. For an overview of who accessed admin data, exported data or changed configuration, ' +
    'use access_report instead.';
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      onboardingId: {
        type: 'string',
        description:
          'Only entries about this onboarding. Cannot be combined with resourceType or resourceId.',
      },
      actorType: {
        type: 'string',
        description: 'Only entries by this actor type, e.g. system, operator, anonymous.',
      },
      actorId: {
        type: 'string',
        description: 'Only entries by this actor, e.g. an operator object id.',
      },
      action: {
        type: 'string',
        description: 'Only entries with exactly this action, e.g. onboarding.state_transition.',
      },
      actionPrefix: {
        type: 'string',
        description: 'Only entries whose action starts with this text, e.g. webhook. or auth.',
      },
      resourceType: { type: 'string', description: 'Only entries about this resource type.' },
      resourceId: { type: 'string', description: 'Only entries about this resource.' },
      occurredFrom: {
        type: 'string',
        description: 'Earliest time, inclusive: an ISO-8601 date (2026-10-01) or datetime.',
      },
      occurredTo: {
        type: 'string',
        description:
          'Latest time, inclusive: an ISO-8601 date (a bare date includes that whole UTC day) or datetime.',
      },
    },
    additionalProperties: false,
  };

  constructor(private readonly audit: AuditReader) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<SearchAuditResult> {
    const onboardingId = findString(args, 'onboardingId', MAX_FILTER_LENGTH);
    const resourceType = findString(args, 'resourceType', MAX_TYPE_LENGTH);
    const resourceId = findString(args, 'resourceId', MAX_FILTER_LENGTH);
    const actionPrefix = findString(args, 'actionPrefix', MAX_FILTER_LENGTH);

    if (onboardingId !== undefined && (resourceType !== undefined || resourceId !== undefined)) {
      throw new ToolError('Give onboardingId or resourceType and resourceId, not both.');
    }

    const { from: occurredFrom, to: occurredTo } = findDateRange(
      args,
      'occurredFrom',
      'occurredTo',
    );

    const { entries, truncated } = await this.audit.scan(
      {
        actorType: findString(args, 'actorType', MAX_TYPE_LENGTH),
        actorId: findString(args, 'actorId', MAX_FILTER_LENGTH),
        action: findString(args, 'action', MAX_FILTER_LENGTH),
        resourceType: onboardingId === undefined ? resourceType : ONBOARDING_RESOURCE_TYPE,
        resourceId: onboardingId ?? resourceId,
        occurredFrom: occurredFrom?.toISOString(),
        occurredTo: occurredTo?.toISOString(),
      },
      context,
      {
        maxEntries: SEARCH_AUDIT_MAX_ENTRIES,
        matches:
          actionPrefix === undefined ? undefined : (entry) => entry.action.startsWith(actionPrefix),
      },
    );
    const masked = await this.audit.maskEntries(entries, context);

    return {
      entries: masked,
      count: masked.length,
      truncated,
      ...(truncated
        ? {
            note: `More entries match than are shown (the search stops at ${SEARCH_AUDIT_MAX_ENTRIES} entries or after reading the log's newest pages). Narrow the time window or add filters.`,
          }
        : {}),
    };
  }
}
